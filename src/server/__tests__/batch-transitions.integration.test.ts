import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import {
  notifications,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import { ConsoleEmailSender } from "#/lib/email/console-sender";
import type { BatchTarget } from "#/lib/project-workflow";
import type { ProjectStatus } from "#/lib/vocabularies";
import {
  BATCH_REFRESH_CONCURRENCY,
  settleProjectRefreshes,
} from "#/server/_internal/project-refresh";
import { batchTransitionAs } from "#/server/_internal/projects";
import { batchTransitionSchema } from "#/server/projects";

/**
 * The admin list's batch archive and publish (#889): all or nothing, locked
 * in id order so overlapping batches cannot both pass, one bell row per
 * proposer, no email, and the refreshes after a publish bounded.
 */

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const embedNow = () => Promise.resolve(VECTOR);

let seq = 0;
async function makeUser(role: "user" | "admin") {
  const email = `batch-${Date.now()}-${seq++}@x.com`;
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeProject(
  status: ProjectStatus,
  over: Partial<typeof projects.$inferInsert> = {}
) {
  const [row] = await db
    .insert(projects)
    .values({
      title: `Project ${seq++}`,
      description: "A rover that streams sensor data.",
      status,
      ...over,
    })
    .returning();
  return row;
}

async function historyFor(ids: string[]) {
  return db
    .select()
    .from(projectStatusHistory)
    .where(inArray(projectStatusHistory.projectId, ids));
}

async function bellFor(userIds: string[]) {
  return db
    .select()
    .from(notifications)
    .where(inArray(notifications.userId, userIds));
}

afterEach(async () => {
  await settleProjectRefreshes();
  vi.restoreAllMocks();
});

describe("batchTransitionAs", () => {
  it("archives every published project, with history, one bell row per proposer and no email", async () => {
    const send = vi.spyOn(ConsoleEmailSender.prototype, "send");
    const admin = await makeUser("admin");
    const many = await makeUser("user");
    const one = await makeUser("user");
    const batch = [
      await makeProject("published", { proposerId: many.id }),
      await makeProject("published", { proposerId: many.id }),
      await makeProject("published", { proposerId: one.id }),
      await makeProject("published", { proposerId: null }),
    ];
    const ids = batch.map((p) => p.id);

    const result = await batchTransitionAs(
      admin,
      ids,
      "archived",
      " End of term. ",
      { embed: embedNow }
    );
    expect(result.ids).toEqual([...ids].sort());

    const after = await db
      .select()
      .from(projects)
      .where(inArray(projects.id, ids));
    expect(after.every((p) => p.status === "archived")).toBe(true);
    expect(after.every((p) => p.archivedAt instanceof Date)).toBe(true);

    const history = await historyFor(ids);
    expect(history).toHaveLength(ids.length);
    for (const row of history) {
      expect(row).toMatchObject({
        oldStatus: "published",
        newStatus: "archived",
        changedBy: admin.id,
        comment: "End of term.",
      });
    }

    const bell = await bellFor([many.id, one.id, admin.id]);
    expect(bell.map((n) => [n.userId, n.title, n.link]).sort()).toEqual(
      [
        [many.id, "2 of your projects were archived", "/my/projects"],
        [
          one.id,
          `Your project '${batch[2].title}' is now archived`,
          `/projects/${batch[2].id}`,
        ],
      ].sort()
    );
    expect(bell.every((n) => n.message.includes("End of term."))).toBe(true);

    await settleProjectRefreshes();
    expect(send).not.toHaveBeenCalled();
  });

  it("publishes every approved project, sets a first publishedAt and bounds the refreshes", async () => {
    const admin = await makeUser("admin");
    const earlier = new Date("2025-09-01T00:00:00.000Z");
    const batch = [
      await makeProject("approved", { publishedAt: earlier }),
      ...(await Promise.all(
        Array.from({ length: 9 }, () => makeProject("approved"))
      )),
    ];
    const ids = batch.map((p) => p.id);

    // Every embed call parks until the test lets it go, so the peak counts
    // how many refreshes ran at once rather than how fast each finished.
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const releases: (() => void)[] = [];
    const embed = () => {
      calls++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise<number[]>((resolve) => {
        releases.push(() => {
          inFlight--;
          resolve(VECTOR);
        });
      });
    };

    await batchTransitionAs(admin, ids, "published", null, { embed });

    const after = await db
      .select()
      .from(projects)
      .where(inArray(projects.id, ids));
    expect(after.every((p) => p.status === "published")).toBe(true);
    const first = after.find((p) => p.id === batch[0].id);
    expect(first?.publishedAt?.toISOString()).toBe(earlier.toISOString());
    expect(
      after.filter((p) => p.id !== batch[0].id).every((p) => p.publishedAt)
    ).toBe(true);

    // Release in waves until every refresh has run.
    while (calls < ids.length || releases.length > 0) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      expect(inFlight).toBeLessThanOrEqual(BATCH_REFRESH_CONCURRENCY);
      for (const release of releases.splice(0)) {
        release();
      }
    }
    await settleProjectRefreshes();
    expect(calls).toBe(ids.length);
    expect(peak).toBe(BATCH_REFRESH_CONCURRENCY);

    const embedded = await db
      .select({ embedding: projects.embedding })
      .from(projects)
      .where(inArray(projects.id, ids));
    expect(embedded.every((p) => p.embedding)).toBe(true);
  });

  it.each([
    ["its status changed", { status: "archived" as const }],
    ["it was soft-deleted", { deletedAt: new Date() }],
  ])(
    "refuses the whole batch, naming the project, when one is no longer eligible because %s",
    async (_why, change) => {
      const admin = await makeUser("admin");
      const proposer = await makeUser("user");
      const stays = await makeProject("published", { proposerId: proposer.id });
      const stale = await makeProject("published", {
        proposerId: proposer.id,
        title: "Kelp forest sonar",
      });
      await db.update(projects).set(change).where(eq(projects.id, stale.id));

      await expect(
        batchTransitionAs(admin, [stays.id, stale.id], "archived", "Bye.")
      ).rejects.toThrow(
        "Nothing was archived. These changed since the list loaded: Kelp forest sonar."
      );

      const [still] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, stays.id));
      expect(still.status).toBe("published");
      expect(still.archivedAt).toBeNull();
      expect(await historyFor([stays.id, stale.id])).toEqual([]);
      expect(await bellFor([proposer.id])).toEqual([]);
    }
  );

  it("gives one success and one refusal for two overlapping batches started together", async () => {
    const a = await makeUser("admin");
    const b = await makeUser("admin");
    const proposer = await makeUser("user");
    const batch = await Promise.all(
      Array.from({ length: 5 }, () =>
        makeProject("published", { proposerId: proposer.id })
      )
    );
    const ids = batch.map((p) => p.id);

    const results = await Promise.allSettled([
      batchTransitionAs(a, ids, "archived", null, { embed: embedNow }),
      batchTransitionAs(b, [...ids].reverse(), "archived", null, {
        embed: embedNow,
      }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const refused = results.find((r) => r.status === "rejected");
    expect(String((refused as PromiseRejectedResult).reason)).toContain(
      "Nothing was archived."
    );
    expect(await historyFor(ids)).toHaveLength(ids.length);
    expect(await bellFor([proposer.id])).toHaveLength(1);
  });

  it("refuses a viewer who is not staff", async () => {
    const owner = await makeUser("user");
    const project = await makeProject("published", { proposerId: owner.id });
    await expect(
      batchTransitionAs(owner, [project.id], "archived", null)
    ).rejects.toThrow();
    const [still] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(still.status).toBe("published");
  });

  it("refuses archived to published, since an archived row is not approved", async () => {
    const admin = await makeUser("admin");
    const archived = await makeProject("archived", { title: "Old rover" });
    await expect(
      batchTransitionAs(admin, [archived.id], "published", null)
    ).rejects.toThrow("These changed since the list loaded: Old rover.");
  });

  it.each(["draft", "submitted", "changes_requested", "approved"] as const)(
    "refuses a batch to %s",
    async (target) => {
      const admin = await makeUser("admin");
      const project = await makeProject("submitted");
      await expect(
        batchTransitionAs(
          admin,
          [project.id],
          target as unknown as BatchTarget,
          null
        )
      ).rejects.toThrow(`Batch transition to ${target} not allowed`);
      expect(await historyFor([project.id])).toEqual([]);
    }
  );

  it("locks and writes an id sent in two cases once", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject("published");
    await batchTransitionAs(
      admin,
      [project.id, project.id.toUpperCase()],
      "archived",
      null,
      { embed: embedNow }
    );
    expect(await historyFor([project.id])).toHaveLength(1);
  });
});

describe("batchTransitionSchema", () => {
  const id = "3f1c2b8e-5d6a-4c7b-9e0f-1a2b3c4d5e6f";

  it("fails an empty id list", () => {
    expect(
      batchTransitionSchema.safeParse({ ids: [], target: "archived" }).success
    ).toBe(false);
  });

  it("fails a target that is not a batch target", () => {
    for (const target of ["approved", "draft", "submitted"]) {
      expect(
        batchTransitionSchema.safeParse({ ids: [id], target }).success
      ).toBe(false);
    }
  });

  it("takes the two batch targets", () => {
    for (const target of ["archived", "published"]) {
      expect(
        batchTransitionSchema.safeParse({ ids: [id], target }).success
      ).toBe(true);
    }
  });
});
