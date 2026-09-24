import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
  projectComments,
  projectEditLog,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";
import {
  dateFieldIsNullable,
  PROGRAM_FILTER_NONE,
} from "#/lib/admin-project-filters";
import { dayRange } from "#/lib/day-range";
import {
  canEditProject,
  canSeeProject,
  canSeeStatusHistory,
  filterCommentsForViewer,
  projectDetailView,
} from "#/lib/project-visibility";
import { truncateOnWordBoundary } from "#/lib/social-meta";
import { stripMarkdown } from "#/lib/strip-markdown";
import { assertStaff, isStaff, type Viewer } from "#/lib/viewer";
import type { ProjectStatus } from "#/lib/vocabularies";
import type { AdminProjectsFilter } from "../projects-queries";
import {
  adminProjectSummarySelect,
  inNoProgram,
  mentorNameSql,
  projectCategoriesText,
  projectProgramsList,
  projectProgramsText,
  projectSummarySelect,
  runsInProgram,
  sharesAProgramWith,
} from "./project-summary";

/** How many similar projects a project page lists (#614). */
const SIMILAR_PROJECTS_LIMIT = 5;

/**
 * The excerpt's ceiling in characters, ellipsis included. The row clamps to
 * two lines in CSS; this only keeps the payload from carrying a whole
 * description to be hidden.
 */
const SIMILAR_PROJECT_EXCERPT_LENGTH = 160;

/** The vocabulary plus the sentinel this filter adds for "no filter". */
type StatusFilter = "all" | ProjectStatus;

async function getViewer(): Promise<Viewer> {
  const session = await readSession();
  return session?.user
    ? { id: session.user.id, role: session.user.role ?? null }
    : null;
}

export async function listMyProjectsImpl(data: { status: StatusFilter }) {
  const viewer = await getViewer();
  if (!viewer) {
    return { rows: [], teamCapacity: 0 };
  }
  const conditions = [
    eq(projects.proposerId, viewer.id),
    isNull(projects.deletedAt),
  ];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  const [rows, [capacity]] = await Promise.all([
    db
      .select(projectSummarySelect)
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt)),
    // Deliberately NOT filtered by `data.status`: this is the owner's standing
    // commitment across everything still live, so it must not move when they
    // change the status filter. Archived projects no longer take teams.
    db
      .select({
        teamCapacity: sql<number>`coalesce(sum(${projects.teamsSupported}), 0)::int`,
      })
      .from(projects)
      .where(
        and(
          eq(projects.proposerId, viewer.id),
          isNull(projects.deletedAt),
          ne(projects.status, "archived")
        )
      ),
  ]);
  return { rows, teamCapacity: capacity?.teamCapacity ?? 0 };
}

/**
 * The projects that name the viewer's address as mentor (#380). This is the
 * project sense of "mentor", `projects.mentor_email` matched the way
 * `mentorNameSql` resolves the name, and not the profile's `wantsToMentor`.
 * Every status, so a mentor sees the draft they were named on before it is
 * public; soft-deleted rows out. Mentorship grants nothing (CONTEXT.md), so
 * the rows are the public summary and the page links to the public project
 * page, where the mentor sees what any visitor sees. A project whose mentor
 * is changed drops out silently. No `mentor_id`: the schema comment on
 * `mentor_email` rejects one on purpose, and the address is the link.
 */
export function listMentoredProjectsAs(viewer: { email: string }) {
  return db
    .select(projectSummarySelect)
    .from(projects)
    .where(
      and(
        sql`lower(${projects.mentorEmail}) = lower(${viewer.email})`,
        isNull(projects.deletedAt)
      )
    )
    .orderBy(desc(projects.updatedAt));
}

export async function listMentoredProjectsImpl() {
  const session = await readSession();
  if (!session?.user) {
    return { rows: [] };
  }
  return { rows: await listMentoredProjectsAs(session.user) };
}

/** The column each From and To pair narrows on. */
const ADMIN_DATE_COLUMN = {
  archived: projects.archivedAt,
  created: projects.createdAt,
  published: projects.publishedAt,
  updated: projects.updatedAt,
} as const;

/**
 * The scope the proposer dropdown is built from: the status set, the date
 * range, program, the soft-delete switch and the five flag switches, but NOT
 * the search text or the proposer choice itself. Excluding the proposer keeps
 * the option you picked from being the only one left; excluding `q` keeps
 * typing in the search box from emptying the dropdown underneath you.
 *
 * The range is a plain comparison on the chosen column, so a range on
 * `publishedAt` excludes rows that were never published; the field selector
 * on the page is where that shows (#335).
 */
function buildAdminProjectScope(
  data: AdminProjectsFilter,
  opts: { withDateRange?: boolean } = {}
): SQL[] {
  const { withDateRange = true } = opts;
  const scope: SQL[] = [inArray(projects.status, data.statuses)];
  if (!data.includeSoftDeleted) {
    scope.push(isNull(projects.deletedAt));
  }
  // "none" is the third state of the Program control, not a fourth switch:
  // projects nobody has filed under a program yet, which is a staff to-do the
  // same shape as `withoutMentorOnly` below (#458). A project whose last
  // program was deleted lands here too, since the join row is
  // `on delete cascade`.
  //
  // A project runs in a set of programs (#462), so a UUID is an any-match:
  // the filter is still single-valued and a project shared between two
  // programs answers to both.
  if (data.program === PROGRAM_FILTER_NONE) {
    scope.push(inNoProgram);
  } else if (data.program) {
    scope.push(runsInProgram(data.program));
  }
  const column = ADMIN_DATE_COLUMN[data.dateField];
  const { start, end } = dayRange(data.from, data.to);
  if (withDateRange && start) {
    scope.push(gte(column, start));
  }
  if (withDateRange && end) {
    scope.push(lt(column, end));
  }
  // The same three conditions the public listing applies under the same
  // param names (#340), so a link moved between the two pages narrows the
  // same way.
  if (data.acceptingOnly) {
    scope.push(eq(projects.acceptingApplicants, true));
  }
  if (data.studentProposedOnly) {
    scope.push(eq(projects.studentProposed, true));
  }
  if (data.requiresNdaOnly) {
    scope.push(eq(projects.requiresNdaIp, true));
  }
  // Staff-only: no address recorded (#402). With "Student proposed" on,
  // this is the to-do the mentors page is matched against.
  if (data.withoutMentorOnly) {
    scope.push(isNull(projects.mentorEmail));
  }
  return scope;
}

/**
 * The conditions that select the listing's rows: the scope, plus the proposer
 * filter, plus the search text. The CSV export calls this too, so the file can
 * never disagree with the table about which rows match.
 */
function buildAdminProjectListConditions(data: AdminProjectsFilter): SQL[] {
  const listConditions: SQL[] = [...buildAdminProjectScope(data)];
  if (data.proposer) {
    listConditions.push(eq(projects.proposerId, data.proposer));
  }
  const trimmed = data.q.trim();
  if (trimmed) {
    // Same tsvector-plus-title-ILIKE shape as the public listing, so a
    // partial word still matches what staff hunting for a half-remembered
    // title actually type. True since #476, which gave the public listing
    // the ILIKEs this comment had been claiming for it. Extended with
    // proposer and mentor fields, which stay staff-only: matching a public
    // search against one would leak it by inference.
    //
    // The pattern is raw, so `%` and `_` in a staff query behave as
    // wildcards. The public path escapes them in `escapeLikePattern`
    // (`_internal/search.ts`); this one is staff-only and is left as it is
    // rather than fixed in passing.
    const like = `%${trimmed}%`;
    const match = or(
      sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
      ilike(projects.title, like),
      ilike(projects.contactName, like),
      ilike(projects.contactEmail, like),
      ilike(user.name, like),
      ilike(user.email, like),
      // Both proposer addresses, not only the account's. The Proposer column
      // renders `coalesce(user.email, projects.proposer_email)`, and a
      // proposer named by address who has not signed in yet has nothing but
      // the stored column, as does one whose account was deleted. Matching
      // the join alone put an address on the page that the search box above
      // it could not find (#451).
      ilike(projects.proposerEmail, like),
      // The mentor, by both strings the Mentor column shows: the stored
      // address, which is all an unlinked mentor has, and the name it
      // resolves to (#617).
      ilike(projects.mentorEmail, like),
      ilike(mentorNameSql, like)
    );
    if (match) {
      listConditions.push(match);
    }
  }
  return listConditions;
}

/**
 * How many rows the date range is hiding because they have no date at all,
 * rather than because they fall outside it.
 *
 * Counted against the scope with the range removed, so it answers "invisible
 * no matter which range you pick" rather than "outside this one". Zero unless
 * a range is actually set and the chosen column is nullable, so the listing
 * pays for one extra count only when the notice could say something.
 */
async function countDatelessInScope(
  data: AdminProjectsFilter
): Promise<number> {
  const { start, end } = dayRange(data.from, data.to);
  if (!((start || end) && dateFieldIsNullable(data.dateField))) {
    return 0;
  }
  const conditions = [
    ...buildAdminProjectScope(data, { withDateRange: false }),
    isNull(ADMIN_DATE_COLUMN[data.dateField]),
  ];
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(...conditions));
  return row?.count ?? 0;
}

/**
 * Test seam. Integration tests call this directly with a viewer instead of
 * going through the request session, matching the `*As(viewer, ...)`
 * convention used by the mutation helpers.
 */
export async function listAdminProjectsAs(
  viewer: Viewer,
  data: AdminProjectsFilter
) {
  assertStaff(viewer);
  const scope = buildAdminProjectScope(data);
  const listConditions = buildAdminProjectListConditions(data);

  const [rows, proposers, datelessInScope] = await Promise.all([
    db
      .select(adminProjectSummarySelect)
      .from(projects)
      // Left, not inner: `proposerId` is `onDelete: "set null"`, so an inner join
      // would silently drop projects whose proposer account was removed.
      .leftJoin(user, eq(projects.proposerId, user.id))
      .where(listConditions.length ? and(...listConditions) : undefined)
      .orderBy(desc(projects.updatedAt)),
    db
      .selectDistinct({
        email: user.email,
        id: user.id,
        name: user.name,
      })
      .from(projects)
      .innerJoin(user, eq(projects.proposerId, user.id))
      .where(scope.length ? and(...scope) : undefined)
      .orderBy(asc(user.name)),
    countDatelessInScope(data),
  ]);
  return { datelessInScope, proposers, rows };
}

export async function listAdminProjectsImpl(data: AdminProjectsFilter) {
  return listAdminProjectsAs(await getViewer(), data);
}

/**
 * The staff CSV export. Same conditions and same order as the listing, no
 * pagination, and a projection widened to every meaningful column.
 *
 * `notes` is included even though it is staff-only, because this function is
 * staff-gated and an export that silently dropped the staff notes would be
 * the more surprising behavior. The gate is what makes that safe.
 */
export async function exportAdminProjectsAs(
  viewer: Viewer,
  data: AdminProjectsFilter
) {
  assertStaff(viewer);
  const conditions = buildAdminProjectListConditions(data);
  const rows = await db
    .select({
      ...adminProjectSummarySelect,
      // The CSV wants text, not the chip objects and program objects the
      // listing renders.
      categories: projectCategoriesText,
      programs: projectProgramsText,
      notes: projects.notes,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .leftJoin(user, eq(projects.proposerId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

export async function exportAdminProjectsImpl(data: AdminProjectsFilter) {
  return exportAdminProjectsAs(await getViewer(), data);
}

/**
 * Test seam. Integration tests call this directly with a viewer instead of
 * going through the request session, matching the `*As(viewer, ...)`
 * convention used by the mutation helpers.
 */
export async function getProjectAs(viewer: Viewer, data: { id: string }) {
  // The row plus the derived seeking badge. Selected here rather than joined
  // by the view, because the view is pure and this is the only place a
  // project row is read for the detail page. The mentor's name is not read:
  // nothing about the mentor is public (#336).
  //
  // The programs come from the same correlated subquery
  // `projectSummarySelect` carries for the card and the table. The rendered
  // strings differ on purpose: the detail page badges the full labels where
  // the card and the tables show course ids alone, which is #462 breaking
  // the continuity #449 established. `project-card.tsx` has the reasoning.
  // `getTableColumns` keeps the selection flat, which is what stopped the
  // old join folding the row under table names, the shape `getProgram` was
  // caught by (docs/QUIRKS.md). `projectDetailView` still names every field
  // it passes on, so this widens the projection's input, not its output.
  const [project] = await db
    .select({
      ...getTableColumns(projects),
      programs: projectProgramsList,
    })
    .from(projects)
    .where(eq(projects.id, data.id));
  if (!project) {
    return {
      project: null,
      history: [],
      canEdit: false,
      viewerIsStaff: false,
      viewerIsOwner: false,
    };
  }
  if (!canSeeProject(project, viewer)) {
    return {
      project: null,
      history: [],
      canEdit: false,
      viewerIsStaff: false,
      viewerIsOwner: false,
    };
  }

  // Named field by field, so a new column on `projects` cannot ride this
  // payload. It matters here more than anywhere: this page is public, so the
  // object below is serialized into the SSR payload for anonymous viewers.
  // The embedding vector and search_vector are among the columns that simply
  // are not named, rather than being nulled after the fact.
  const detail = projectDetailView(project, viewer);
  // The status timeline (and its comments) is private to staff and the
  // proposer. Everyone else gets an empty history, so the field is not just
  // hidden in the UI but never leaves the server.
  const history = canSeeStatusHistory(project, viewer)
    ? await db
        .select({
          id: projectStatusHistory.id,
          oldStatus: projectStatusHistory.oldStatus,
          newStatus: projectStatusHistory.newStatus,
          // The name, not the id, and not the address beside it.
          //
          // The join is total, so it can never drop an audit row: `changed_by`
          // is `notNull` with `onDelete: "restrict"`, and ADR 0008 scrubs a
          // deleted account rather than removing the row the trail is anchored
          // to. `user.name` is `notNull` too, which is what lets the caller
          // take a plain `string`.
          //
          // No address: this history reaches the proposer, who is not staff
          // (`canSeeStatusHistory`), and nothing renders it. That is the case
          // `projectDetailView` leaves a field out for rather than nulling it.
          // The inventory item history does carry one, but `getItemHistoryAs`
          // is staff only, so it is not a precedent for this payload.
          changedByName: user.name,
          comment: projectStatusHistory.comment,
          createdAt: projectStatusHistory.createdAt,
        })
        .from(projectStatusHistory)
        .innerJoin(user, eq(projectStatusHistory.changedBy, user.id))
        .where(eq(projectStatusHistory.projectId, data.id))
        .orderBy(asc(projectStatusHistory.createdAt))
    : [];

  const viewerIsStaff = isStaff(viewer);
  const viewerIsOwner = !!viewer && project.proposerId === viewer.id;
  // The predicate, not a copy of it. An inline reimplementation here used to
  // deny staff on an archived project while the write paths that call
  // canEditProject allowed it, so the page hid an edit button for a write the
  // server would have accepted.
  const canEdit = canEditProject(project, viewer);

  return {
    project: detail,
    history,
    canEdit,
    viewerIsStaff,
    viewerIsOwner,
  };
}

export async function getProjectImpl(data: { id: string }) {
  return getProjectAs(await getViewer(), data);
}

export async function getSimilarProjectsImpl(data: { projectId: string }) {
  return getSimilarProjectsAs(await getViewer(), data);
}

/**
 * The similar-projects list on a project page (#614): published projects that
 * share a program with the viewed one, nearest to it by embedding. The same
 * for every viewer.
 */
export interface SimilarProject {
  /** The description as plain text, cut on a word boundary. Empty when there is none. */
  excerpt: string;
  id: string;
  title: string;
}

export async function getSimilarProjectsAs(
  viewer: Viewer,
  data: { projectId: string }
) {
  // Whether it has a vector, not the vector: the distance is computed in
  // Postgres, so the 1024 floats never cross to Node.
  const [viewed] = await db
    .select({
      id: projects.id,
      proposerId: projects.proposerId,
      status: projects.status,
      deletedAt: projects.deletedAt,
      hasEmbedding: sql<boolean>`${projects.embedding} IS NOT NULL`,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  // The page's own gate, so a stranger cannot learn the neighbours of a
  // draft or a soft-deleted project by guessing its id.
  if (!(viewed?.hasEmbedding && canSeeProject(viewed, viewer))) {
    return [];
  }
  const viewedEmbedding = sql`(
    SELECT viewed.embedding FROM projects viewed WHERE viewed.id = ${data.projectId}
  )`;
  // The order is index-eligible, and an HNSW scan returns its nearest
  // `ef_search` (40) before the WHERE runs: with most of the table archived,
  // that can leave none of the 40 published. `strict_order` has pgvector
  // (0.8+) keep scanning until the LIMIT is met, still in distance order.
  // SET LOCAL needs the transaction, and it ends with it, so the setting
  // never leaks onto a pooled connection.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
    return await tx
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
      })
      .from(projects)
      .where(
        and(
          eq(projects.status, "published"),
          eq(projects.acceptingApplicants, true),
          isNull(projects.deletedAt),
          isNotNull(projects.embedding),
          // Again, inside this statement: a refresh that failed between the
          // check above and here nulls the vector, and a NULL distance would
          // quietly order the list by id instead of nearness.
          sql`${viewedEmbedding} IS NOT NULL`,
          ne(projects.id, data.projectId),
          sharesAProgramWith(data.projectId)
        )
      )
      .orderBy(sql`${projects.embedding} <=> ${viewedEmbedding}`, projects.id)
      .limit(SIMILAR_PROJECTS_LIMIT);
  });
  return rows.map(
    (row): SimilarProject => ({
      id: row.id,
      title: row.title,
      excerpt: truncateOnWordBoundary(
        stripMarkdown(row.description),
        SIMILAR_PROJECT_EXCERPT_LENGTH
      ),
    })
  );
}

export interface ProposerForEdit {
  accountLinked: boolean;
  accountName: string | null;
  email: string;
  /** Saved with the link (#336): the Proposer section's checkbox reads it from here. */
  studentProposed: boolean;
}

export async function getProposerForEditAs(
  viewer: Viewer,
  data: { projectId: string }
): Promise<ProposerForEdit> {
  assertStaff(viewer);
  const [project] = await db
    .select({
      proposerId: projects.proposerId,
      proposerEmail: projects.proposerEmail,
      studentProposed: projects.studentProposed,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    return {
      accountLinked: false,
      accountName: null,
      email: "",
      studentProposed: false,
    };
  }
  // proposerId is canonical: when the project is linked to an account, prefill
  // that account's current email so an untouched staff save re-resolves to the
  // same proposer. Fall back to the stored email only when no account is linked.
  if (project.proposerId) {
    const [account] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, project.proposerId));
    if (account?.email) {
      return {
        accountLinked: true,
        accountName: account.name ?? null,
        email: account.email,
        studentProposed: project.studentProposed,
      };
    }
  }
  return {
    accountLinked: false,
    accountName: null,
    email: project.proposerEmail ?? "",
    studentProposed: project.studentProposed,
  };
}

export interface ProjectMentorship {
  /** As stored. Empty string when unset, so the input can bind to it directly. */
  mentorEmail: string;
  /** The account at that address, if one exists. Null is "no account yet". */
  mentorName: string | null;
}

/**
 * The staff read of the mentor. Nothing about the mentor is public (#336):
 * this is the one endpoint that returns the address and the resolved name,
 * and it must not widen, for the same reason `getProposerForEditAs` does not.
 */
export async function getProjectMentorshipAs(
  viewer: Viewer,
  data: { projectId: string }
): Promise<ProjectMentorship> {
  assertStaff(viewer);
  const [row] = await db
    .select({
      mentorEmail: projects.mentorEmail,
      mentorName: mentorNameSql,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!row) {
    throw new Error("Project not found");
  }
  return {
    mentorEmail: row.mentorEmail ?? "",
    mentorName: row.mentorName,
  };
}

export async function getProjectMentorshipImpl(data: { projectId: string }) {
  return getProjectMentorshipAs(await getViewer(), data);
}

/**
 * Request-context wrapper. Mirrors the *As / *Impl split the rest of this file
 * uses so integration tests can call the As form directly.
 */
export async function getProposerForEditImpl(data: {
  projectId: string;
}): Promise<ProposerForEdit> {
  return getProposerForEditAs(await getViewer(), data);
}

/**
 * Test seam, the same *As / *Impl split the rest of this file uses: the gate
 * lived inside the Impl, where nothing but a request could reach it, and so
 * had no refusal test.
 *
 * The editor is joined for a name, the way `getProjectAs` joins the status
 * history's actor: an id prefix answered nothing about who made an edit
 * (#467). The join is inner and total, because `editor_id` is `notNull` with
 * `onDelete: restrict` and ADR-0008 scrubs a deleted account's name to
 * "Deleted user" rather than removing the row, so no audit row can drop out.
 *
 * `oldValues` and `newValues` are deliberately not selected, matching
 * `listInventoryItemEditLogAs`. They hold the before and after of every
 * changed field, notes included, and nothing renders them, so selecting them
 * would ship staff-private strings to a browser with no reader for them.
 */
export async function listProjectEditLogAs(
  viewer: Viewer,
  data: { id: string }
) {
  assertStaff(viewer);
  const rows = await db
    .select({
      id: projectEditLog.id,
      editorId: projectEditLog.editorId,
      editorName: user.name,
      changedFields: projectEditLog.changedFields,
      createdAt: projectEditLog.createdAt,
    })
    .from(projectEditLog)
    .innerJoin(user, eq(projectEditLog.editorId, user.id))
    .where(eq(projectEditLog.projectId, data.id))
    .orderBy(desc(projectEditLog.createdAt));
  return { rows };
}

export async function listProjectEditLogImpl(data: { id: string }) {
  return listProjectEditLogAs(await getViewer(), data);
}

export async function listProjectCommentsAs(
  viewer: Viewer,
  data: { id: string }
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.id));
  if (!(project && canSeeProject(project, viewer))) {
    throw new Error("Forbidden");
  }
  // Join the author so the thread can render a name instead of a raw id. The
  // FK is `onDelete: restrict`, so the row is always there; the left join and
  // the fallback below only guard against a future relaxation of that rule.
  const rows = await db
    .select({
      id: projectComments.id,
      projectId: projectComments.projectId,
      authorId: projectComments.authorId,
      authorName: user.name,
      parentId: projectComments.parentId,
      content: projectComments.content,
      isInternal: projectComments.isInternal,
      createdAt: projectComments.createdAt,
      editedAt: projectComments.editedAt,
    })
    .from(projectComments)
    .leftJoin(user, eq(user.id, projectComments.authorId))
    .where(eq(projectComments.projectId, data.id))
    .orderBy(asc(projectComments.createdAt));
  // Derived from every child on the project, before the filter below removes
  // the ones this viewer may not see. A proposer whose comment drew an
  // internal staff reply receives no child for it, so a thread that counted
  // its own children would offer them an Edit the server then refuses (#503).
  // `hasReply` states the fact; authorship is the client's half of the
  // decision, and it already has that from `authorId`.
  const parentsWithReplies = new Set(
    rows.flatMap((r) => (r.parentId ? [r.parentId] : []))
  );
  // `isMine` rather than the viewer's own id on the wire: the thread needs to
  // know which rows are the reader's, not who the reader is.
  const withLock = rows.map((r) => ({
    ...r,
    hasReply: parentsWithReplies.has(r.id),
    isMine: !!viewer && r.authorId === viewer.id,
  }));
  return { rows: filterCommentsForViewer(withLock, viewer, project) };
}

export async function listProjectCommentsImpl(data: { id: string }) {
  return listProjectCommentsAs(await getViewer(), data);
}
