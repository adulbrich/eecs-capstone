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
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { PROJECT_STATUSES_IN_DISPLAY_ORDER } from "#/lib/project-workflow";
import { assertStaff, type Viewer } from "#/lib/viewer";
import {
  INVENTORY_ITEM_STATUSES,
  INVENTORY_REQUEST_ITEM_STATUSES,
} from "#/lib/vocabularies";
import type { AnalyticsInput } from "../analytics";
import { countPendingRequests, countRows, countSubmitted } from "./admin";

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

/**
 * The breakdown's bar order. Shared with the staff stepper, so the two cannot
 * show a reader the same statuses in two different orders.
 */
export const PROJECT_STATUSES = PROJECT_STATUSES_IN_DISPLAY_ORDER;

export const ITEM_STATUSES = INVENTORY_ITEM_STATUSES;

export const LINE_STATUSES = INVENTORY_REQUEST_ITEM_STATUSES;

export const USER_ROLES = ["admin", "instructor", "user"] as const;

export interface AnalyticsView {
  asOf: Date;
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
    publishedWithoutBookmarks: number;
    publishedWithoutMentor: number;
    requestsWithPending: number;
    seekingMentor: number;
    submittedAwaiting: number;
  };
  program: { id: string; label: string } | null;
}

const DAY_MS = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The range as half-open instants, and the period of the same length that
 * ends the day before it. Previous period rather than same point last cycle:
 * that comparison needs a stored academic-year boundary this deliberately
 * does not add.
 */
function periods(input: AnalyticsInput) {
  const start = new Date(`${input.from}T00:00:00Z`);
  const end = new Date(new Date(`${input.to}T00:00:00Z`).getTime() + DAY_MS);
  const length = end.getTime() - start.getTime();
  const previousStart = new Date(start.getTime() - length);
  return {
    start,
    end,
    previousStart,
    previousEnd: start,
    range: {
      from: input.from,
      to: input.to,
      previousFrom: isoDay(previousStart),
      previousTo: isoDay(new Date(start.getTime() - DAY_MS)),
    },
  };
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
    programId ? eq(projects.programId, programId) : undefined
  );
  const published = and(live, sql`${projects.status} = 'published'`);

  const [
    [slots],
    expected,
    submittedAwaiting,
    oldestSubmitted,
    [seeking],
    [mentored],
    [unmentored],
    mentors,
    [overdue],
    [pending],
    requestsWithPending,
    [unbookmarked],
  ] = await Promise.all([
    db
      .select({
        slots: sql<number>`coalesce(sum(${projects.teamsSupported}), 0)::int`,
      })
      .from(projects)
      .where(published),
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
        ${programId ? sql`and p.program_id = ${programId}` : sql``}
    `),
    db
      .select({ seeking: countRows() })
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
    // Since publication, not absolute, or every project looks doomed in its
    // first week. A project with no published_at counts every bookmark.
    db
      .select({ unbookmarked: countRows() })
      .from(projects)
      .where(
        and(
          published,
          sql`not exists (
            select 1 from ${projectBookmarks} b
            where b.project_id = ${projects.id}
              and (${projects.publishedAt} is null or b.created_at >= ${projects.publishedAt})
          )`
        )
      ),
  ]);

  const expectedRow = expected[0];
  return {
    publishedTeamSlots: slots?.slots ?? 0,
    expectedTeams:
      expectedRow && expectedRow.set > 0 ? expectedRow.total : null,
    expectedTeamsPrograms: {
      set: expectedRow?.set ?? 0,
      total: expectedRow?.programs ?? 0,
    },
    submittedAwaiting,
    oldestSubmittedAt: toDate(oldestSubmitted.rows[0]?.oldest),
    seekingMentor: seeking?.seeking ?? 0,
    publishedWithMentor: mentored?.mentored ?? 0,
    publishedWithoutMentor: unmentored?.unmentored ?? 0,
    mentors,
    overdueItems: overdue?.overdue ?? 0,
    oldestOverdueAt: toDate(overdue?.oldest),
    pendingLines: pending?.lines ?? 0,
    oldestPendingRequestAt: toDate(pending?.oldest),
    requestsWithPending,
    publishedWithoutBookmarks: unbookmarked?.unbookmarked ?? 0,
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
        programId ? eq(projects.programId, programId) : undefined
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

async function breakdowns(programId: string | null, isAdmin: boolean) {
  const live = and(
    isNull(projects.deletedAt),
    programId ? eq(projects.programId, programId) : undefined
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
          .leftJoin(programs, eq(projects.programId, programs.id))
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
    isAdmin
      ? db
          .select({ key: user.role, count: countRows() })
          .from(user)
          .where(isNull(user.deletedAt))
          .groupBy(user.role)
      : Promise.resolve(null),
  ]);
  return {
    projectsByStatus: fill(PROJECT_STATUSES, byStatus),
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
    itemsByStatus: fill(ITEM_STATUSES, itemsByStatus),
    itemsByCategory,
    requestLinesByStatus: fill(LINE_STATUSES, linesByStatus),
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
  const isAdmin = viewer.role === "admin";
  const p = periods(input);
  const programId = input.programId;

  const [program, head, submitted, published, inventory, newUsers, groups] =
    await Promise.all([
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
      isAdmin ? flow(usersIn, p) : Promise.resolve(null),
      breakdowns(programId, isAdmin),
    ]);

  return {
    asOf: new Date(),
    program,
    headline: head,
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
