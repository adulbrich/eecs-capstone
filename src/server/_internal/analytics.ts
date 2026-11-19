import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  categories,
  inventoryItemCategories,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  programs,
  projectBookmarks,
  projectCategories,
  projectPrograms,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { bookmarksPer } from "#/lib/analytics-copy";
import { comparisonPeriods } from "#/lib/day-range";
import { PROJECT_STATUSES_IN_DISPLAY_ORDER } from "#/lib/project-workflow";
import { assertStaff, isAdmin, type Viewer } from "#/lib/viewer";
import {
  INVENTORY_ITEM_STATUSES,
  INVENTORY_REQUEST_ITEM_STATUSES,
  USER_ROLES,
} from "#/lib/vocabularies";
import type { AnalyticsInput } from "../analytics";
import { countPendingRequests, countRows, countSubmitted } from "./admin";
import { projectProgramCount, runsInProgram } from "./project-summary";

export interface Flow {
  current: number;
  previous: number;
}

export interface Bucket {
  count: number;
  key: string;
}

export interface LabelledBucket extends Bucket {
  label: string;
}

/** A published project's bookmarks since publication, against its teams. */
export interface ProjectDemand {
  bookmarks: number;
  id: string;
  teamsSupported: number;
  title: string;
}

/**
 * One category's published projects, the teams they support and their
 * bookmarks since publication. A project in two categories counts in full in both.
 */
export interface CategoryDemand {
  bookmarks: number;
  /** The category's id: a name can repeat across facets. */
  key: string;
  label: string;
  projects: number;
  teamsSupported: number;
}

export interface AnalyticsView {
  asOf: Date;
  /**
   * Published projects in scope with at least one category, one row per
   * category, most bookmarks per team first (#518).
   */
  bookmarksByCategory: CategoryDemand[];
  /**
   * Every published project in scope, zeros included, most bookmarks per
   * team first, then most bookmarks, then title (#518). The page's default
   * sort is per team alone, and tied rows keep this order.
   */
  bookmarksByProject: ProjectDemand[];
  breakdowns: {
    itemsByCategory: Bucket[];
    itemsByStatus: Bucket[];
    projectsByCategory: Bucket[];
    /** Null when one program is selected: it is the dimension itself. */
    projectsByProgram: LabelledBucket[] | null;
    projectsByStatus: Bucket[];
    requestLinesByStatus: Bucket[];
    /** Admin only; null for an instructor. */
    usersByRole: Bucket[] | null;
  };
  flows: {
    inventoryRequests: Flow;
    /** Admin only; null for an instructor. */
    newUsers: Flow | null;
    published: Flow;
    range: {
      from: string;
      previousFrom: string;
      previousTo: string;
      to: string;
    };
    submitted: Flow;
  };
  headline: {
    /** Null when no selected program has a value set: "not set", not zero. */
    expectedTeams: number | null;
    /**
     * How many of the programs in scope have a value, out of how many. With
     * every program selected the expectation is a sum over the programs that
     * set one, and the page says when that denominator is partial.
     */
    expectedTeamsPrograms: { set: number; total: number };
    mentors: {
      /** Published projects whose mentor address matches no mentor account. */
      assignedWithoutCapacity: number;
      assigned: number;
      capacity: number;
      offered: number;
      unassignedCapacity: number;
    };
    oldestOverdueAt: Date | null;
    oldestPendingRequestAt: Date | null;
    oldestSubmittedAt: Date | null;
    overdueItems: number;
    pendingLines: number;
    publishedTeamSlots: number;
    publishedWithMentor: number;
    /**
     * Published projects in scope running in more than one program. Their
     * whole `teams_supported` counts under each, so the per program figures
     * do not sum to the global one and `slotsHint` names the reason (#462).
     */
    sharedProjects: number;
    /**
     * The zero rows of `bookmarksByProject`, counted from them so the tile
     * and the table cannot disagree.
     */
    publishedWithoutBookmarks: number;
    publishedWithoutMentor: number;
    requestsWithPending: number;
    /** Student-proposed projects with no mentor address, every live status (#402). */
    studentProposedWithoutMentor: number;
    submittedAwaiting: number;
  };
  program: { id: string; label: string } | null;
}

/**
 * The range as half-open instants, and the period of the same length that
 * ends the day before it. Previous period rather than same point last cycle:
 * that comparison needs a stored academic-year boundary this deliberately
 * does not add.
 */
function periods(input: AnalyticsInput) {
  // Office days, the same reading `/admin/projects` gives a date (#335).
  return comparisonPeriods(input.from, input.to);
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fill(
  keys: readonly string[],
  rows: { key: string | null; count: number }[]
): Bucket[] {
  const counts = new Map(rows.map((r) => [r.key ?? "", r.count]));
  return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

async function headline(programId: string | null) {
  const live = and(
    isNull(projects.deletedAt),
    programId ? runsInProgram(programId) : undefined
  );
  const published = and(live, sql`${projects.status} = 'published'`);

  const [
    [slots],
    [shared],
    expected,
    submittedAwaiting,
    oldestSubmitted,
    [studentProposedWithoutMentor],
    [mentored],
    [unmentored],
    mentors,
    [overdue],
    [pending],
    requestsWithPending,
  ] = await Promise.all([
    db
      .select({
        slots: sql<number>`coalesce(sum(${projects.teamsSupported}), 0)::int`,
      })
      .from(projects)
      .where(published),
    // How many of those projects run in more than one program. Their whole
    // `teams_supported` lands under each, so the per program figures stop
    // summing to the global one and `slotsHint` says so (#462).
    db
      .select({ shared: countRows() })
      .from(projects)
      .where(and(published, sql`${projectProgramCount} > 1`)),
    db
      .select({
        total: sql<number>`coalesce(sum(${programs.expectedTeams}), 0)::int`,
        set: sql<number>`count(${programs.expectedTeams})::int`,
        programs: countRows(),
      })
      .from(programs)
      .where(programId ? eq(programs.id, programId) : undefined),
    countSubmitted(programId),
    // The age of the oldest wait is the point: twelve waiting says nothing,
    // "oldest 23 days" says whether to act today. The wait starts at the
    // project's most recent move into submitted; a row with no history
    // (seeded, or imported) falls back to its own updated_at rather than
    // dropping out of the minimum.
    db.execute<{ oldest: string | null }>(sql`
      select min(coalesce(h.created_at, p.updated_at)) as oldest
      from ${projects} p
      left join lateral (
        select created_at from ${projectStatusHistory}
        where project_id = p.id and new_status = 'submitted'
        order by created_at desc limit 1
      ) h on true
      where p.status = 'submitted' and p.deleted_at is null
        ${
          // The same predicate the Drizzle queries use, told which name the
          // outer row goes by here: this query aliases `projects` as `p`.
          programId
            ? sql`and ${runsInProgram(programId, sql.raw("p.id"))}`
            : sql``
        }
    `),
    db
      // The staff to-do, over the live scope the tile always had: every
      // status, not only published, so staff see a student proposal with
      // nobody yet before it reaches the catalog (#402).
      .select({ count: countRows() })
      .from(projects)
      .where(
        and(
          live,
          eq(projects.studentProposed, true),
          isNull(projects.mentorEmail)
        )
      ),
    db
      .select({ mentored: countRows() })
      .from(projects)
      .where(and(published, isNotNull(projects.mentorEmail))),
    db
      .select({ unmentored: countRows() })
      .from(projects)
      .where(and(published, isNull(projects.mentorEmail))),
    mentorFigures(),
    // Overdue is derived, never stored (docs/QUIRKS.md, inventory): a
    // checkout past its due date, or a reservation past its pickup date.
    db
      .select({
        overdue: countRows(),
        oldest: sql<
          string | null
        >`min(case when ${inventoryItems.status} = 'checked_out' then ${inventoryItems.currentDueAt} else ${inventoryItems.currentPickupBy} end)`,
      })
      .from(inventoryItems)
      .where(
        sql`(${inventoryItems.status} = 'checked_out' and ${inventoryItems.currentDueAt} < now())
          or (${inventoryItems.status} = 'reserved' and ${inventoryItems.currentPickupBy} < now())`
      ),
    db
      .select({
        lines: countRows(),
        oldest: sql<string | null>`min(${inventoryRequests.createdAt})`,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .where(eq(inventoryRequestItems.status, "pending")),
    countPendingRequests(),
  ]);

  const expectedRow = expected[0];
  return {
    publishedTeamSlots: slots?.slots ?? 0,
    sharedProjects: shared?.shared ?? 0,
    expectedTeams:
      expectedRow && expectedRow.set > 0 ? expectedRow.total : null,
    expectedTeamsPrograms: {
      set: expectedRow?.set ?? 0,
      total: expectedRow?.programs ?? 0,
    },
    submittedAwaiting,
    oldestSubmittedAt: toDate(oldestSubmitted.rows[0]?.oldest),
    studentProposedWithoutMentor: studentProposedWithoutMentor?.count ?? 0,
    publishedWithMentor: mentored?.mentored ?? 0,
    publishedWithoutMentor: unmentored?.unmentored ?? 0,
    mentors,
    overdueItems: overdue?.overdue ?? 0,
    oldestOverdueAt: toDate(overdue?.oldest),
    pendingLines: pending?.lines ?? 0,
    oldestPendingRequestAt: toDate(pending?.oldest),
    requestsWithPending,
  };
}

/**
 * When a bookmark counts as interest in a published project: made at or
 * after its publication, or always when `published_at` is null. Since
 * publication rather than ever, so a project is not credited with the
 * bookmarks staff made on its draft in review. The one statement of the
 * rule: both bookmark tables read through it, and the unbookmarked tile is
 * their zeros.
 */
const countsSincePublication = sql`(${projects.publishedAt} is null or ${projectBookmarks.createdAt} >= ${projects.publishedAt})`;

/**
 * Every published project in scope with its bookmarks since publication. A
 * left join, with the rule in its `on`, so a project nobody bookmarked keeps
 * its row at zero; counted on a bookmark column, not `count(*)`, which would
 * give that row a one.
 */
function bookmarksPerProject(programId: string | null) {
  return db
    .select({
      id: projects.id,
      title: projects.title,
      teamsSupported: projects.teamsSupported,
      bookmarks: sql<number>`count(${projectBookmarks.userId})::int`.as(
        "bookmarks"
      ),
    })
    .from(projects)
    .leftJoin(
      projectBookmarks,
      and(eq(projectBookmarks.projectId, projects.id), countsSincePublication)
    )
    .where(
      and(
        isNull(projects.deletedAt),
        eq(projects.status, "published"),
        programId ? runsInProgram(programId) : undefined
      )
    )
    .groupBy(projects.id);
}

/**
 * Most bookmarks per team first, a row with no teams last, then most
 * bookmarks, then the name. The page sorts both tables on the ratio alone,
 * and TanStack keeps tied rows in the order they arrived
 * (`createSortedRowModel` falls back to the row index), so this order is
 * what breaks the page's ties.
 */
function byDemand<T>(
  rows: T[],
  demand: (row: T) => {
    bookmarks: number;
    id: string;
    name: string;
    teams: number;
  }
): T[] {
  const keyed = rows.map((row) => {
    const d = demand(row);
    return {
      ...d,
      per: bookmarksPer(d.bookmarks, d.teams) ?? Number.NEGATIVE_INFINITY,
      row,
    };
  });
  keyed.sort(
    (a, b) =>
      (a.per === b.per ? 0 : b.per - a.per) ||
      b.bookmarks - a.bookmarks ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );
  return keyed.map((k) => k.row);
}

/**
 * The two bookmark tables (#518). Per project, then per category from the
 * same per-project counts as a subquery, so a project in two categories
 * contributes its teams and its bookmarks once to each. A flat join of
 * categories to bookmarks would add its teams once per bookmark.
 */
async function bookmarkDemand(programId: string | null) {
  const perProject = bookmarksPerProject(programId).as("per_project");
  const [byProject, byCategory] = await Promise.all([
    bookmarksPerProject(programId),
    db
      .select({
        key: categories.id,
        label: categories.name,
        projects: countRows(),
        teamsSupported: sql<number>`coalesce(sum(${perProject.teamsSupported}), 0)::int`,
        bookmarks: sql<number>`coalesce(sum(${perProject.bookmarks}), 0)::int`,
      })
      .from(perProject)
      .innerJoin(
        projectCategories,
        eq(projectCategories.projectId, perProject.id)
      )
      .innerJoin(categories, eq(projectCategories.categoryId, categories.id))
      // By id: the unique index is per domain, type and name, so two facets
      // can each hold a category of the same name.
      .groupBy(categories.id, categories.name),
  ]);
  return {
    byProject: byDemand(byProject, (row) => ({
      bookmarks: row.bookmarks,
      id: row.id,
      name: row.title,
      teams: row.teamsSupported,
    })),
    byCategory: byDemand(byCategory, (row) => ({
      bookmarks: row.bookmarks,
      id: row.key,
      name: row.label,
      teams: row.teamsSupported,
    })),
  };
}

/**
 * Global on purpose: a mentor's capacity is not per program. Capacity is
 * trackable only for mentors with an account, so a mentor named by address
 * who has not signed up shows as an assignment against no capacity, which is
 * the truth and is labelled as such on the page.
 */
async function mentorFigures() {
  const [offering, assignments] = await Promise.all([
    db
      .select({
        email: sql<string>`lower(${user.email})`,
        capacity: user.mentorTeamCount,
      })
      .from(user)
      .where(and(eq(user.wantsToMentor, true), isNull(user.deletedAt))),
    db
      .select({
        email: sql<string>`lower(${projects.mentorEmail})`,
        assigned: countRows(),
      })
      .from(projects)
      .where(
        and(
          isNull(projects.deletedAt),
          sql`${projects.status} = 'published'`,
          isNotNull(projects.mentorEmail)
        )
      )
      .groupBy(sql`lower(${projects.mentorEmail})`),
  ]);
  const assignedByEmail = new Map(
    assignments.map((a) => [a.email, a.assigned])
  );
  let capacity = 0;
  let unassignedCapacity = 0;
  for (const mentor of offering) {
    capacity += mentor.capacity;
    unassignedCapacity += Math.max(
      0,
      mentor.capacity - (assignedByEmail.get(mentor.email) ?? 0)
    );
  }
  const mentorEmails = new Set(offering.map((m) => m.email));
  let assigned = 0;
  let assignedWithoutCapacity = 0;
  for (const a of assignments) {
    assigned += a.assigned;
    if (!mentorEmails.has(a.email)) {
      assignedWithoutCapacity += a.assigned;
    }
  }
  return {
    offered: offering.length,
    capacity,
    assigned,
    unassignedCapacity,
    assignedWithoutCapacity,
  };
}

async function transitionsIn(
  status: "submitted" | "published",
  start: Date,
  end: Date,
  programId: string | null
): Promise<number> {
  const [row] = await db
    .select({ n: countRows() })
    .from(projectStatusHistory)
    .innerJoin(projects, eq(projectStatusHistory.projectId, projects.id))
    .where(
      and(
        eq(projectStatusHistory.newStatus, status),
        gte(projectStatusHistory.createdAt, start),
        lt(projectStatusHistory.createdAt, end),
        // Same population as the stocks: a soft-deleted project's history
        // does not count as a submission that happened.
        isNull(projects.deletedAt),
        programId ? runsInProgram(programId) : undefined
      )
    );
  return row?.n ?? 0;
}

async function usersIn(start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ n: countRows() })
    .from(user)
    // Scrubbed accounts stay out, as they do from the by-role breakdown.
    .where(
      and(
        isNull(user.deletedAt),
        gte(user.createdAt, start),
        lt(user.createdAt, end)
      )
    );
  return row?.n ?? 0;
}

async function requestsIn(start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ n: countRows() })
    .from(inventoryRequests)
    .where(
      and(
        gte(inventoryRequests.createdAt, start),
        lt(inventoryRequests.createdAt, end)
      )
    );
  return row?.n ?? 0;
}

async function flow(
  run: (start: Date, end: Date) => Promise<number>,
  p: ReturnType<typeof periods>
): Promise<Flow> {
  const [current, previous] = await Promise.all([
    run(p.start, p.end),
    run(p.previousStart, p.previousEnd),
  ]);
  return { current, previous };
}

async function breakdowns(programId: string | null, viewerIsAdmin: boolean) {
  const live = and(
    isNull(projects.deletedAt),
    programId ? runsInProgram(programId) : undefined
  );
  const [
    byStatus,
    byProgram,
    byCategory,
    itemsByStatus,
    itemsByCategory,
    linesByStatus,
    byRole,
  ] = await Promise.all([
    db
      .select({ key: projects.status, count: countRows() })
      .from(projects)
      .where(live)
      .groupBy(projects.status),
    programId
      ? Promise.resolve(null)
      : db
          .select({
            id: programs.id,
            courseId: programs.courseId,
            courseName: programs.courseName,
            count: countRows(),
          })
          .from(projects)
          // Both joins left: a project in no program keeps its row under the
          // null key, which is the unfiled bucket the page renders, and a
          // project in two programs produces a row under each and counts in
          // both (#462).
          .leftJoin(projectPrograms, eq(projectPrograms.projectId, projects.id))
          .leftJoin(programs, eq(projectPrograms.programId, programs.id))
          .where(isNull(projects.deletedAt))
          .groupBy(programs.id, programs.courseId, programs.courseName),
    db
      .select({ key: categories.name, count: countRows() })
      .from(projectCategories)
      .innerJoin(projects, eq(projectCategories.projectId, projects.id))
      .innerJoin(categories, eq(projectCategories.categoryId, categories.id))
      .where(live)
      .groupBy(categories.name)
      .orderBy(sql`count(*) desc`, categories.name),
    db
      .select({ key: inventoryItems.status, count: countRows() })
      .from(inventoryItems)
      .groupBy(inventoryItems.status),
    db
      .select({ key: categories.name, count: countRows() })
      .from(inventoryItemCategories)
      .innerJoin(
        categories,
        eq(inventoryItemCategories.categoryId, categories.id)
      )
      .groupBy(categories.name)
      .orderBy(sql`count(*) desc`, categories.name),
    db
      .select({ key: inventoryRequestItems.status, count: countRows() })
      .from(inventoryRequestItems)
      .groupBy(inventoryRequestItems.status),
    viewerIsAdmin
      ? db
          .select({ key: user.role, count: countRows() })
          .from(user)
          .where(isNull(user.deletedAt))
          .groupBy(user.role)
      : Promise.resolve(null),
  ]);
  return {
    projectsByStatus: fill(PROJECT_STATUSES_IN_DISPLAY_ORDER, byStatus),
    projectsByProgram: byProgram
      ? byProgram
          .map((row) => ({
            key: row.id ?? "none",
            label: row.id ? `${row.courseId} ${row.courseName}` : "No program",
            count: row.count,
          }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      : null,
    projectsByCategory: byCategory,
    itemsByStatus: fill(INVENTORY_ITEM_STATUSES, itemsByStatus),
    itemsByCategory,
    requestLinesByStatus: fill(INVENTORY_REQUEST_ITEM_STATUSES, linesByStatus),
    usersByRole: byRole ? fill(USER_ROLES, byRole) : null,
  };
}

/**
 * Staff only, matching the rest of `/admin`. The user figures are admin only,
 * matching the existing gate on the users count, and are null rather than
 * absent for an instructor so the page renders one shape.
 */
export async function getAnalyticsAs(
  viewer: NonNullable<Viewer>,
  input: AnalyticsInput
): Promise<AnalyticsView> {
  assertStaff(viewer);
  const viewerIsAdmin = isAdmin(viewer);
  const p = periods(input);
  const programId = input.programId;

  const [
    program,
    head,
    submitted,
    published,
    inventory,
    newUsers,
    groups,
    demand,
  ] = await Promise.all([
    programId
      ? db
          .select({
            id: programs.id,
            courseId: programs.courseId,
            courseName: programs.courseName,
          })
          .from(programs)
          .where(eq(programs.id, programId))
          .then(([row]) =>
            row
              ? { id: row.id, label: `${row.courseId} ${row.courseName}` }
              : null
          )
      : Promise.resolve(null),
    headline(programId),
    flow((s, e) => transitionsIn("submitted", s, e, programId), p),
    flow((s, e) => transitionsIn("published", s, e, programId), p),
    flow(requestsIn, p),
    viewerIsAdmin ? flow(usersIn, p) : Promise.resolve(null),
    breakdowns(programId, viewerIsAdmin),
    bookmarkDemand(programId),
  ]);

  return {
    asOf: new Date(),
    program,
    headline: {
      ...head,
      // Derived, not queried: the tile is the table's zeros by construction,
      // and ADR-0064 counts every connection this page opens.
      publishedWithoutBookmarks: demand.byProject.filter(
        (row) => row.bookmarks === 0
      ).length,
    },
    bookmarksByProject: demand.byProject,
    bookmarksByCategory: demand.byCategory,
    flows: {
      range: p.range,
      submitted,
      published,
      inventoryRequests: inventory,
      newUsers,
    },
    breakdowns: groups,
  };
}

export async function getAnalyticsForCurrentUser(
  input: AnalyticsInput
): Promise<AnalyticsView> {
  const viewer = await requireUser();
  return getAnalyticsAs(viewer, input);
}
