import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  categories,
  inventoryItems,
  projectBookmarks,
  projectCategories,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import type { UserRole } from "#/lib/vocabularies";
import { getAdminStatsAs } from "#/server/_internal/admin";
import { getAnalyticsAs } from "#/server/_internal/analytics";
import { addToCartAs, submitCartAs } from "#/server/_internal/inventory-cart";
import { createProgramAs } from "#/server/_internal/programs";
import {
  createProjectAs,
  forceTransitionAs,
  updateProjectProgramsAs,
} from "#/server/_internal/projects";

async function makeUser(email: string, role: UserRole) {
  await auth.api.createUser({
    body: { email, name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

function baseProject() {
  return {
    title: "T",
    description: "D",
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    contactName: "P",
    contactEmail: "p@x.test",
    url: null,
    licenseRestrictions: null,
    requiresNdaIp: false,
    isSponsored: false,
    teamsSupported: 2,
    acceptingApplicants: true,
    imageUrl: null,
    notes: null,
    categoryIds: [],
  };
}

function day(offset: number): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Today, and the thirty days before it. */
const RANGE = { from: day(-30), to: day(0) };

describe("the program selector", () => {
  it("filters the figures marked program-scoped and leaves the global ones alone", async () => {
    const admin = await makeUser(`an-a-${Date.now()}@x.com`, "admin");
    const a = await createProgramAs(admin, {
      courseId: `AN-A-${Date.now()}`,
      courseName: "A",
      description: null,
      expectedTeams: 5,
    });
    const b = await createProgramAs(admin, {
      courseId: `AN-B-${Date.now()}`,
      courseName: "B",
      description: null,
      expectedTeams: null,
    });
    // Placed after create: `createProjectAs` stopped carrying a program in
    // #450, so the staff writer is the only one that sets the column.
    const inA = await createProjectAs(admin, baseProject());
    await updateProjectProgramsAs(admin, {
      id: inA.id,
      programIds: [a.id],
      acceptingApplicants: true,
      teamsSupported: 2,
    });
    const inB = await createProjectAs(admin, baseProject());
    await updateProjectProgramsAs(admin, {
      id: inB.id,
      programIds: [b.id],
      acceptingApplicants: true,
      teamsSupported: 2,
    });
    await forceTransitionAs(admin, inA.id, "published", undefined, {
      sendEmail: false,
    });
    await forceTransitionAs(admin, inB.id, "submitted", undefined, {
      sendEmail: false,
    });
    // A global figure: one pending request line, in no program.
    const student = await makeUser(`an-s-${Date.now()}@x.com`, "user");
    const [item] = await db
      .insert(inventoryItems)
      .values({ name: `AN item ${Date.now()}`, description: null })
      .returning();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });

    const all = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    const onlyA = await getAnalyticsAs(admin, { ...RANGE, programId: a.id });
    const onlyB = await getAnalyticsAs(admin, { ...RANGE, programId: b.id });

    expect(all.headline.publishedTeamSlots).toBe(2);
    expect(onlyA.headline.publishedTeamSlots).toBe(2);
    expect(onlyB.headline.publishedTeamSlots).toBe(0);
    expect(all.headline.submittedAwaiting).toBe(1);
    expect(onlyA.headline.submittedAwaiting).toBe(0);
    expect(onlyB.headline.submittedAwaiting).toBe(1);
    expect(onlyB.headline.oldestSubmittedAt).toBeInstanceOf(Date);
    expect(onlyA.headline.oldestSubmittedAt).toBeNull();
    // Global, whatever the selector says.
    for (const view of [all, onlyA, onlyB]) {
      expect(view.headline.pendingLines).toBe(1);
      expect(view.headline.requestsWithPending).toBe(1);
    }
    // The program dimension hides itself once one program is selected.
    expect(all.breakdowns.projectsByProgram).not.toBeNull();
    expect(onlyA.breakdowns.projectsByProgram).toBeNull();
    expect(onlyA.breakdowns.projectsByStatus).toEqual(
      expect.arrayContaining([{ key: "published", count: 1 }])
    );
    expect(onlyA.breakdowns.projectsByStatus).not.toEqual(
      expect.arrayContaining([{ key: "submitted", count: 1 }])
    );
  });

  // The documented semantic of #462, not a bug: `teams_supported` is one
  // number on the project, shared across its programs, so a shared project
  // contributes all of it to each and the per program figures stop summing
  // to the global one. `slotsHint` says so under the tile.
  it("counts a shared project in full under each of its programs", async () => {
    const admin = await makeUser(`an-sh-${Date.now()}@x.com`, "admin");
    const a = await createProgramAs(admin, {
      courseId: `AN-S1-${Date.now()}`,
      courseName: "Corvallis",
      description: null,
      expectedTeams: null,
    });
    const b = await createProgramAs(admin, {
      courseId: `AN-S2-${Date.now()}`,
      courseName: "Ecampus",
      description: null,
      expectedTeams: null,
    });
    // teamsSupported is 2 on baseProject().
    const shared = await createProjectAs(admin, baseProject());
    await updateProjectProgramsAs(admin, {
      id: shared.id,
      programIds: [a.id, b.id],
      acceptingApplicants: true,
      teamsSupported: 2,
    });
    await forceTransitionAs(admin, shared.id, "published", undefined, {
      sendEmail: false,
    });

    const all = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    const onlyA = await getAnalyticsAs(admin, { ...RANGE, programId: a.id });
    const onlyB = await getAnalyticsAs(admin, { ...RANGE, programId: b.id });

    // Two under each, two globally: the per program figures deliberately
    // over-count against the whole.
    expect(onlyA.headline.publishedTeamSlots).toBe(2);
    expect(onlyB.headline.publishedTeamSlots).toBe(2);
    expect(all.headline.publishedTeamSlots).toBe(2);
    // And the tile names the reason rather than leaving staff to find it.
    expect(all.headline.sharedProjects).toBe(1);
    expect(onlyA.headline.sharedProjects).toBe(1);

    // The program breakdown groups through the join table, so the project
    // appears in a row for each program rather than once under one.
    const byProgram = all.breakdowns.projectsByProgram ?? [];
    expect(byProgram.find((r) => r.key === a.id)?.count).toBe(1);
    expect(byProgram.find((r) => r.key === b.id)?.count).toBe(1);
  });

  it("compares published slots against expected teams, and says when that is not set", async () => {
    const admin = await makeUser(`an-e-${Date.now()}@x.com`, "admin");
    const set = await createProgramAs(admin, {
      courseId: `AN-E1-${Date.now()}`,
      courseName: "Set",
      description: null,
      expectedTeams: 8,
    });
    const unset = await createProgramAs(admin, {
      courseId: `AN-E2-${Date.now()}`,
      courseName: "Unset",
      description: null,
    });
    const withSet = await getAnalyticsAs(admin, {
      ...RANGE,
      programId: set.id,
    });
    const withUnset = await getAnalyticsAs(admin, {
      ...RANGE,
      programId: unset.id,
    });
    expect(withSet.headline.expectedTeams).toBe(8);
    // Null, never zero: the page renders "not set" rather than a comparison.
    expect(withUnset.headline.expectedTeams).toBeNull();
    // Across all programs the expectation is the sum of what is set; with
    // nothing set anywhere it is null too.
    const all = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(all.headline.expectedTeams).toBe(8);
    // And it says the denominator is partial: one of the two set a value.
    expect(all.headline.expectedTeamsPrograms).toEqual({ set: 1, total: 2 });
    expect(withUnset.headline.expectedTeamsPrograms).toEqual({
      set: 0,
      total: 1,
    });
  });
});

describe("overdue inventory", () => {
  it("counts a late return and a missed pickup, and nothing healthy, as overdueFlags would", async () => {
    const admin = await makeUser(`an-ov-${Date.now()}@x.com`, "admin");
    const past = new Date(Date.now() - 3 * 86_400_000);
    const future = new Date(Date.now() + 3 * 86_400_000);
    await db.insert(inventoryItems).values([
      {
        name: `AN late ${Date.now()}`,
        description: null,
        status: "checked_out",
        currentDueAt: past,
      },
      {
        name: `AN missed ${Date.now()}`,
        description: null,
        status: "reserved",
        currentPickupBy: past,
      },
      {
        name: `AN fine ${Date.now()}`,
        description: null,
        status: "checked_out",
        currentDueAt: future,
      },
    ]);
    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.headline.overdueItems).toBe(2);
    expect(view.headline.oldestOverdueAt?.getTime()).toBe(past.getTime());
  });
});

describe("the date range", () => {
  it("governs the flows and their previous-period comparison, and not the stocks", async () => {
    const admin = await makeUser(`an-d-${Date.now()}@x.com`, "admin");
    const recent = await createProjectAs(admin, baseProject());
    const old = await createProjectAs(admin, baseProject());
    await forceTransitionAs(admin, recent.id, "submitted", undefined, {
      sendEmail: false,
    });
    await forceTransitionAs(admin, old.id, "submitted", undefined, {
      sendEmail: false,
    });
    // Age the second submission into the previous period.
    await db
      .update(projectStatusHistory)
      .set({ createdAt: new Date(Date.now() - 45 * 86_400_000) })
      .where(eq(projectStatusHistory.projectId, old.id));

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.flows.submitted).toEqual({ current: 1, previous: 1 });
    // A stock: both are submitted right now, whatever the range.
    expect(view.headline.submittedAwaiting).toBe(2);
    const narrow = await getAnalyticsAs(admin, {
      from: day(-2),
      to: day(0),
      programId: null,
    });
    expect(narrow.flows.submitted).toEqual({ current: 1, previous: 0 });
    expect(narrow.headline.submittedAwaiting).toBe(2);
    expect(narrow.flows.range.previousTo < narrow.flows.range.from).toBe(true);
  });

  it("reads a day as the office does: 10pm Pacific on the 30th is still the 30th", async () => {
    const admin = await makeUser(`an-tz-${Date.now()}@x.com`, "admin");
    const project = await createProjectAs(admin, baseProject());
    await forceTransitionAs(admin, project.id, "published", undefined, {
      sendEmail: false,
    });
    // 2026-07-01T05:00Z is 22:00 Pacific Daylight Time on June 30th. Read
    // as UTC days, as the range was before #335, this lands in July.
    await db
      .update(projectStatusHistory)
      .set({ createdAt: new Date("2026-07-01T05:00:00.000Z") })
      .where(eq(projectStatusHistory.projectId, project.id));

    const june = await getAnalyticsAs(admin, {
      from: "2026-06-30",
      to: "2026-06-30",
      programId: null,
    });
    expect(june.flows.published.current).toBe(1);
    expect(june.flows.range).toEqual({
      from: "2026-06-30",
      to: "2026-06-30",
      previousFrom: "2026-06-29",
      previousTo: "2026-06-29",
    });
    const july = await getAnalyticsAs(admin, {
      from: "2026-07-01",
      to: "2026-07-01",
      programId: null,
    });
    expect(july.flows.published.current).toBe(0);
    // The previous period is the day before, where the publish now sits.
    expect(july.flows.published.previous).toBe(1);
  });
});

describe("who sees the user figures", () => {
  it("gives them to an admin and withholds them from an instructor", async () => {
    const admin = await makeUser(`an-ad-${Date.now()}@x.com`, "admin");
    const instructor = await makeUser(
      `an-in-${Date.now()}@x.com`,
      "instructor"
    );
    const forAdmin = await getAnalyticsAs(admin, {
      ...RANGE,
      programId: null,
    });
    const forInstructor = await getAnalyticsAs(instructor, {
      ...RANGE,
      programId: null,
    });
    expect(forAdmin.flows.newUsers?.current).toBeGreaterThanOrEqual(2);
    expect(forAdmin.breakdowns.usersByRole).not.toBeNull();
    expect(forInstructor.flows.newUsers).toBeNull();
    expect(forInstructor.breakdowns.usersByRole).toBeNull();
  });

  it("refuses a plain user", async () => {
    const plain = await makeUser(`an-p-${Date.now()}@x.com`, "user");
    await expect(
      getAnalyticsAs(plain, { ...RANGE, programId: null })
    ).rejects.toThrow(/Forbidden/u);
  });
});

describe("the figures /admin still shows", () => {
  it("count pending requests the same way on both pages", async () => {
    const admin = await makeUser(`an-q-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`an-qs-${Date.now()}@x.com`, "user");
    const rows = await db
      .insert(inventoryItems)
      .values([
        { name: `AN q1 ${Date.now()}`, description: null },
        { name: `AN q2 ${Date.now()}`, description: null },
      ])
      .returning();
    // Two lines in one request: two pending lines, one pending request.
    for (const row of rows) {
      await addToCartAs(student, { itemId: row.id });
    }
    await submitCartAs(student, { note: null });

    const stats = await getAdminStatsAs(admin);
    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.headline.pendingLines).toBe(2);
    expect(view.headline.requestsWithPending).toBe(1);
    expect(view.headline.requestsWithPending).toBe(stats.pendingRequests);
    expect(view.headline.submittedAwaiting).toBe(stats.submitted);
  });
});

describe("bookmarks since publication", () => {
  it("counts a published project as unbookmarked only for bookmarks after it was published", async () => {
    const admin = await makeUser(`an-b-${Date.now()}@x.com`, "admin");
    const reader = await makeUser(`an-br-${Date.now()}@x.com`, "user");
    const loved = await createProjectAs(admin, baseProject());
    const ignored = await createProjectAs(admin, baseProject());
    for (const id of [loved.id, ignored.id]) {
      await forceTransitionAs(admin, id, "published", undefined, {
        sendEmail: false,
      });
    }
    // Stamped from the app clock, like `publishedAt` is: the database's
    // `now()` can lag the host by a second or two under docker, which would
    // put a bookmark made right after publishing before it. Written after
    // the transition, so `new Date()` is at or past `publishedAt`, and the
    // comparison is `>=`.
    await db.insert(projectBookmarks).values({
      userId: reader.id,
      projectId: loved.id,
      createdAt: new Date(),
    });
    // A bookmark that predates publication does not count: staff bookmark
    // drafts they are reviewing, and that is not student interest.
    await db.insert(projectBookmarks).values({
      userId: admin.id,
      projectId: ignored.id,
      createdAt: new Date(Date.now() - 86_400_000),
    });
    await db
      .update(projects)
      .set({ publishedAt: new Date() })
      .where(eq(projects.id, ignored.id));

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.headline.publishedWithoutBookmarks).toBe(1);
  });
});

describe("bookmark demand per project and per category (#518)", () => {
  type Admin = Awaited<ReturnType<typeof makeUser>>;
  let seq = 0;

  /** A published project with its teams written as a column, in programs. */
  async function published(
    admin: Admin,
    title: string,
    teamsSupported: number,
    programIds: string[] = []
  ) {
    const project = await createProjectAs(admin, { ...baseProject(), title });
    if (programIds.length > 0) {
      await updateProjectProgramsAs(admin, {
        id: project.id,
        programIds,
        acceptingApplicants: true,
        teamsSupported: 1,
      });
    }
    await forceTransitionAs(admin, project.id, "published", undefined, {
      sendEmail: false,
    });
    // Written after the writers, so the count under test is the column's,
    // including the zero that no writer offers but the database allows.
    await db
      .update(projects)
      .set({ teamsSupported })
      .where(eq(projects.id, project.id));
    return project;
  }

  async function readers(n: number) {
    const made: Admin[] = [];
    for (let i = 0; i < n; i++) {
      seq += 1;
      made.push(await makeUser(`an-bd-${seq}-${Date.now()}@x.com`, "user"));
    }
    return made;
  }

  /**
   * Bookmarks stamped from the app clock after publication, as the existing
   * unbookmarked test explains: the database's `now()` can lag the host.
   */
  async function bookmark(projectId: string, by: Admin[]) {
    if (by.length === 0) {
      return;
    }
    await db.insert(projectBookmarks).values(
      by.map((r) => ({
        userId: r.id,
        projectId,
        createdAt: new Date(),
      }))
    );
  }

  async function category(name: string) {
    seq += 1;
    const [row] = await db
      .insert(categories)
      .values({ domain: "project", type: "industry", name: `${name} ${seq}` })
      .returning();
    return row;
  }

  async function file(projectId: string, ...categoryIds: string[]) {
    await db
      .insert(projectCategories)
      .values(categoryIds.map((categoryId) => ({ projectId, categoryId })));
  }

  function zeroRows(view: Awaited<ReturnType<typeof getAnalyticsAs>>) {
    return view.bookmarksByProject.filter((r) => r.bookmarks === 0).length;
  }

  it("counts a bookmark made since publication in both tables and takes its project out of the tile, and one made before in neither", async () => {
    const admin = await makeUser(`an-bd-a-${Date.now()}@x.com`, "admin");
    const [reader] = await readers(1);
    const cat = await category("Marine");
    const early = await published(admin, "Bookmarked in review", 1);
    const late = await published(admin, "Bookmarked once live", 1);
    await file(early.id, cat.id);
    await file(late.id, cat.id);
    // A day before publication: staff or a student looking at a draft.
    await db.insert(projectBookmarks).values({
      userId: reader.id,
      projectId: early.id,
      createdAt: new Date(Date.now() - 86_400_000),
    });
    await bookmark(late.id, [reader]);

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    const byId = new Map(view.bookmarksByProject.map((r) => [r.id, r]));
    expect(byId.get(early.id)?.bookmarks).toBe(0);
    expect(byId.get(late.id)?.bookmarks).toBe(1);
    expect(view.bookmarksByCategory).toEqual([
      { key: cat.id, label: cat.name, projects: 2, slots: 2, bookmarks: 1 },
    ]);
    expect(view.headline.publishedWithoutBookmarks).toBe(1);
  });

  /**
   * Two programs and a project in each, a project in both, and one in none.
   * Bookmarked: the one in A, and the shared one.
   */
  async function programFixture() {
    const admin = await makeUser(`an-bd-p-${Date.now()}@x.com`, "admin");
    const stamp = Date.now();
    const a = await createProgramAs(admin, {
      courseId: `AN-BD-A-${stamp}`,
      courseName: "A",
      description: null,
    });
    const b = await createProgramAs(admin, {
      courseId: `AN-BD-B-${stamp}`,
      courseName: "B",
      description: null,
    });
    const cat = await category("Robotics");
    const inA = await published(admin, "In A", 1, [a.id]);
    const quietA = await published(admin, "Quiet in A", 1, [a.id]);
    const inB = await published(admin, "In B", 1, [b.id]);
    const shared = await published(admin, "In both", 2, [a.id, b.id]);
    const unfiled = await published(admin, "In none", 1);
    for (const p of [inA, inB, shared]) {
      await file(p.id, cat.id);
    }
    const [one, two] = await readers(2);
    await bookmark(inA.id, [one]);
    await bookmark(shared.id, [one, two]);
    return { admin, a, b, cat, inA, quietA, inB, shared, unfiled };
  }

  it("states the tile as the table's zero rows for every program selection", async () => {
    const f = await programFixture();
    const all = await getAnalyticsAs(f.admin, { ...RANGE, programId: null });
    const onlyA = await getAnalyticsAs(f.admin, {
      ...RANGE,
      programId: f.a.id,
    });
    const onlyB = await getAnalyticsAs(f.admin, {
      ...RANGE,
      programId: f.b.id,
    });

    for (const view of [all, onlyA, onlyB]) {
      expect(view.headline.publishedWithoutBookmarks).toBe(zeroRows(view));
    }
    // And the counts are the ones the fixture makes, not two agreeing zeros:
    // quiet in A, in B and in none; quiet in A; in B.
    expect(all.headline.publishedWithoutBookmarks).toBe(3);
    expect(onlyA.headline.publishedWithoutBookmarks).toBe(1);
    expect(onlyB.headline.publishedWithoutBookmarks).toBe(1);
  });

  it("filters both tables by program, and lists a project in two programs under each", async () => {
    const f = await programFixture();
    const all = await getAnalyticsAs(f.admin, { ...RANGE, programId: null });
    const onlyA = await getAnalyticsAs(f.admin, {
      ...RANGE,
      programId: f.a.id,
    });
    const onlyB = await getAnalyticsAs(f.admin, {
      ...RANGE,
      programId: f.b.id,
    });

    const ids = (view: typeof all) =>
      new Set(view.bookmarksByProject.map((r) => r.id));
    expect(ids(all)).toEqual(
      new Set([f.inA.id, f.quietA.id, f.inB.id, f.shared.id, f.unfiled.id])
    );
    expect(ids(onlyA)).toEqual(new Set([f.inA.id, f.quietA.id, f.shared.id]));
    expect(ids(onlyB)).toEqual(new Set([f.inB.id, f.shared.id]));
    // The shared project carries its whole count and its whole teams into
    // each program, as its slots do (ADR-0028).
    for (const view of [onlyA, onlyB]) {
      expect(
        view.bookmarksByProject.find((r) => r.id === f.shared.id)
      ).toMatchObject({ bookmarks: 2, teamsSupported: 2 });
    }
    expect(all.bookmarksByCategory).toEqual([
      { key: f.cat.id, label: f.cat.name, projects: 3, slots: 4, bookmarks: 3 },
    ]);
    expect(onlyA.bookmarksByCategory).toEqual([
      { key: f.cat.id, label: f.cat.name, projects: 2, slots: 3, bookmarks: 3 },
    ]);
    expect(onlyB.bookmarksByCategory).toEqual([
      { key: f.cat.id, label: f.cat.name, projects: 2, slots: 3, bookmarks: 2 },
    ]);
  });

  it("counts a project in two categories in full under each, once, whatever its bookmark count", async () => {
    const admin = await makeUser(`an-bd-c-${Date.now()}@x.com`, "admin");
    const x = await category("UX Design");
    const y = await category("Healthcare");
    // Two teams and three bookmarks: a flat join of categories to bookmarks
    // would report six slots per category.
    const project = await published(admin, "Two categories", 2);
    await file(project.id, x.id, y.id);
    await bookmark(project.id, await readers(3));

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.bookmarksByProject).toEqual([
      {
        id: project.id,
        title: "Two categories",
        teamsSupported: 2,
        bookmarks: 3,
      },
    ]);
    const byKey = new Map(view.bookmarksByCategory.map((r) => [r.key, r]));
    for (const c of [x, y]) {
      expect(byKey.get(c.id)).toEqual({
        key: c.id,
        label: c.name,
        projects: 1,
        slots: 2,
        bookmarks: 3,
      });
    }
  });

  it("leaves an archived and a soft-deleted project out of both tables", async () => {
    const admin = await makeUser(`an-bd-x-${Date.now()}@x.com`, "admin");
    const cat = await category("AWS");
    const live = await published(admin, "Live", 1);
    const archived = await published(admin, "Last cycle", 3);
    const deleted = await published(admin, "Deleted", 3);
    for (const p of [live, archived, deleted]) {
      await file(p.id, cat.id);
    }
    const [reader] = await readers(1);
    for (const p of [live, archived, deleted]) {
      await bookmark(p.id, [reader]);
    }
    await forceTransitionAs(admin, archived.id, "archived", undefined, {
      sendEmail: false,
    });
    await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, deleted.id));

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.bookmarksByProject.map((r) => r.id)).toEqual([live.id]);
    expect(view.bookmarksByCategory).toEqual([
      { key: cat.id, label: cat.name, projects: 1, slots: 1, bookmarks: 1 },
    ]);
  });

  it("orders most bookmarks per team first, then most bookmarks, then title, with no teams last", async () => {
    const admin = await makeUser(`an-bd-o-${Date.now()}@x.com`, "admin");
    const hot = await category("Hot");
    const cold = await category("Cold");
    const [r1, r2, r3, r4] = await readers(4);
    // Per team: 3, 2, 2, 2, 0, none.
    const delta = await published(admin, "Delta", 1);
    const beta = await published(admin, "Beta", 2);
    const gamma = await published(admin, "Gamma", 1);
    const alpha = await published(admin, "Alpha", 1);
    await published(admin, "Quiet", 1);
    const noTeams = await published(admin, "No teams", 0);
    await bookmark(delta.id, [r1, r2, r3]);
    await bookmark(beta.id, [r1, r2, r3, r4]);
    await bookmark(gamma.id, [r1, r2]);
    await bookmark(alpha.id, [r3, r4]);
    await bookmark(noTeams.id, [r1]);
    await file(delta.id, hot.id);
    await file(beta.id, cold.id);

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.bookmarksByProject.map((r) => r.title)).toEqual([
      "Delta",
      "Beta",
      "Alpha",
      "Gamma",
      "Quiet",
      "No teams",
    ]);
    // Hot is 3 per slot, Cold 2.
    expect(view.bookmarksByCategory.map((r) => r.key)).toEqual([
      hot.id,
      cold.id,
    ]);
  });

  it("gives an instructor both tables, as the rest of the page", async () => {
    const admin = await makeUser(`an-bd-ia-${Date.now()}@x.com`, "admin");
    const instructor = await makeUser(
      `an-bd-i-${Date.now()}@x.com`,
      "instructor"
    );
    const cat = await category("Flutter");
    const project = await published(admin, "Seen by staff", 1);
    await file(project.id, cat.id);
    await bookmark(project.id, await readers(1));

    const view = await getAnalyticsAs(instructor, {
      ...RANGE,
      programId: null,
    });
    expect(view.bookmarksByProject).toHaveLength(1);
    expect(view.bookmarksByCategory).toHaveLength(1);
  });
});

describe("student proposed, no mentor", () => {
  it("counts student-proposed projects with no address on file, every live status", async () => {
    const admin = await makeUser(`an-m-${Date.now()}@x.com`, "admin");
    // Two student proposals with nobody yet, one of them a draft; one
    // student proposal with a mentor; one partner project with nobody. The
    // rule is the mark and the address, nothing else (#402): 2.
    const waiting = await createProjectAs(admin, baseProject());
    const waitingDraft = await createProjectAs(admin, baseProject());
    const mentoredStudent = await createProjectAs(admin, baseProject());
    const partner = await createProjectAs(admin, baseProject());
    await forceTransitionAs(admin, waiting.id, "published", undefined, {
      sendEmail: false,
    });
    // Written as columns rather than through the two writers: the figure is
    // a rule over two columns, and the test stays pinned to the columns
    // rather than to whichever wrapper writes each.
    const mentorship = (
      id: string,
      columns: { mentorEmail: string | null; studentProposed: boolean }
    ) => db.update(projects).set(columns).where(eq(projects.id, id));
    for (const id of [waiting.id, waitingDraft.id]) {
      await mentorship(id, { mentorEmail: null, studentProposed: true });
    }
    await mentorship(mentoredStudent.id, {
      mentorEmail: "mentor@x.test",
      studentProposed: true,
    });
    await mentorship(partner.id, { mentorEmail: null, studentProposed: false });

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    expect(view.headline.studentProposedWithoutMentor).toBe(2);
  });

  it("counts every published project with no address as without a mentor", async () => {
    const admin = await makeUser(`an-n-${Date.now()}@x.com`, "admin");
    const missing = await createProjectAs(admin, baseProject());
    const alsoMissing = await createProjectAs(admin, baseProject());
    const mentored = await createProjectAs(admin, baseProject());
    for (const id of [missing.id, alsoMissing.id, mentored.id]) {
      await forceTransitionAs(admin, id, "published", undefined, {
        sendEmail: false,
      });
    }
    await db
      .update(projects)
      .set({ mentorEmail: "mentor@x.test" })
      .where(eq(projects.id, mentored.id));

    const view = await getAnalyticsAs(admin, { ...RANGE, programId: null });
    // No "runs without a mentor" state to exclude since #402: an address or
    // not is the whole fact.
    expect(view.headline.publishedWithoutMentor).toBe(2);
    expect(view.headline.publishedWithMentor).toBe(1);
  });
});
