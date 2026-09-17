import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  inventoryItems,
  projectBookmarks,
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
  updateProjectProgramAs,
} from "#/server/_internal/projects";

async function makeUser(email: string, role: UserRole) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
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
    await updateProjectProgramAs(admin, { id: inA.id, programId: a.id });
    const inB = await createProjectAs(admin, baseProject());
    await updateProjectProgramAs(admin, { id: inB.id, programId: b.id });
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
    ).rejects.toThrow(/Forbidden/);
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
