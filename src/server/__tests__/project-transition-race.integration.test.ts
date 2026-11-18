import { asc, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "#/db";
import { projectStatusHistory, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import type { ProjectStatus } from "#/lib/vocabularies";
import { settleProjectRefreshes } from "#/server/_internal/project-refresh";
import {
  forceTransitionAs,
  performTransitionAs,
} from "#/server/_internal/projects";
import {
  holdOpen,
  untilABackendWaitsOn,
  untilBackendsWaitOn,
} from "./save-race";

/**
 * Two transitions of one project that read it before either writes. Each
 * locks the row and checks it under that lock, so the second sees the
 * first's committed status: it is refused when the workflow no longer allows
 * its move, and its history row names the status it actually left.
 */

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const quiet = {
  embed: () => Promise.resolve(VECTOR),
  sendEmail: false,
};

let seq = 0;
async function makeUser(role: "user" | "admin") {
  const email = `race-${Date.now()}-${seq++}@x.com`;
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeProject(status: ProjectStatus) {
  const [row] = await db
    .insert(projects)
    .values({ status, title: `Race ${seq++}` })
    .returning();
  return row;
}

async function historyFor(id: string) {
  return db
    .select()
    .from(projectStatusHistory)
    .where(eq(projectStatusHistory.projectId, id))
    .orderBy(asc(projectStatusHistory.createdAt), asc(projectStatusHistory.id));
}

async function statusOf(id: string) {
  const [row] = await db
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, id));
  return row.status;
}

/**
 * Starts `first` and `second` while another transaction holds the project's
 * row, and releases it only once both are blocked: `first` on the holder,
 * `second` behind `first` or on the holder. A path that reads outside its
 * lock has read the project by then and blocks only at its write, so both
 * pass their checks on the same status; a path that locks first blocks at
 * its read, and the second reads what the first committed.
 */
async function raceWhileHeld(
  id: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>
) {
  const holder = await holdOpen(
    sql`select 1 from ${projects} where ${projects.id} = ${id} for update`
  );
  const running: Promise<unknown>[] = [];
  try {
    running.push(first());
    running[0].catch(() => undefined);
    const firstPid = await untilABackendWaitsOn(holder.pid);
    running.push(second());
    running[1].catch(() => undefined);
    await untilBackendsWaitOn([holder.pid, firstPid], 2);
  } finally {
    await holder.release();
  }
  return Promise.allSettled(running);
}

afterEach(async () => {
  await settleProjectRefreshes();
});

describe("a status transition racing another", () => {
  it("lets one of two staff moves out of approved win, and refuses the other", async () => {
    const a = await makeUser("admin");
    const b = await makeUser("admin");
    const project = await makeProject("approved");

    const results = await raceWhileHeld(
      project.id,
      () =>
        performTransitionAs(
          a,
          project.id,
          "changes_requested",
          "Fix X.",
          quiet
        ),
      () => performTransitionAs(b, project.id, "published", undefined, quiet)
    );

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain(
      "not allowed"
    );
    expect(await statusOf(project.id)).toBe("changes_requested");
    const history = await historyFor(project.id);
    expect(history.map((h) => [h.oldStatus, h.newStatus, h.changedBy])).toEqual(
      [["approved", "changes_requested", a.id]]
    );
  });

  it("records the status a forced move actually left when a transition lands first", async () => {
    const a = await makeUser("admin");
    const b = await makeUser("admin");
    const project = await makeProject("approved");

    const results = await raceWhileHeld(
      project.id,
      () => performTransitionAs(a, project.id, "published", undefined, quiet),
      () => forceTransitionAs(b, project.id, "archived", undefined, quiet)
    );

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await statusOf(project.id)).toBe("archived");
    const history = await historyFor(project.id);
    expect(history.map((h) => [h.oldStatus, h.newStatus])).toEqual([
      ["approved", "published"],
      ["published", "archived"],
    ]);
  });

  it("refuses the second of two forced moves to the same status", async () => {
    const a = await makeUser("admin");
    const b = await makeUser("admin");
    const project = await makeProject("submitted");

    const results = await raceWhileHeld(
      project.id,
      () => forceTransitionAs(a, project.id, "draft", undefined, quiet),
      () => forceTransitionAs(b, project.id, "draft", undefined, quiet)
    );

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain(
      "already in that status"
    );
    const history = await historyFor(project.id);
    expect(history.map((h) => [h.oldStatus, h.newStatus])).toEqual([
      ["submitted", "draft"],
    ]);
  });
});

describe("the checks a transition runs on the locked row", () => {
  it("refuses an owner who is not the proposer, writing nothing", async () => {
    const stranger = await makeUser("user");
    const project = await makeProject("draft");

    await expect(
      performTransitionAs(stranger, project.id, "submitted", undefined, quiet)
    ).rejects.toThrow("Forbidden");

    expect(await statusOf(project.id)).toBe("draft");
    expect(await historyFor(project.id)).toEqual([]);
  });

  it("refuses a project that does not exist", async () => {
    const admin = await makeUser("admin");
    const missing = "00000000-0000-4000-8000-000000000000";

    await expect(
      performTransitionAs(admin, missing, "approved", undefined, quiet)
    ).rejects.toThrow("Project not found");
    await expect(
      forceTransitionAs(admin, missing, "approved", undefined, quiet)
    ).rejects.toThrow("Project not found");
  });
});
