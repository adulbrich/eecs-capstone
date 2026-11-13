import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import {
  aiReviewUsage,
  categories,
  projectCategories,
  projects,
  user,
} from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { auth } from "#/lib/auth";
import type { CleanupCategoryRef } from "#/lib/category-cleanup";
import {
  applyCategoryCleanupAs,
  CLEANUP_TOOL_NAME,
  proposeCategoryCleanupAs,
} from "#/server/_internal/category-cleanup";
import { lockProjectCategories } from "#/server/_internal/project-category-lock";

/**
 * The category cleanup (#857) against the database. Every model call is a
 * fake `ResponsesFn` that reads the handles out of the catalog it was sent,
 * so a test proposes changes by category name the way the model does by
 * handle.
 */

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "admin" ? { role } : {}) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function seedCategories() {
  const rows = await db
    .insert(categories)
    .values([
      { domain: "project", type: "Kind of work", name: "New Build" },
      {
        domain: "project",
        type: "Field",
        name: "AR / VR",
        description: "Augmented and virtual reality.",
      },
      {
        domain: "project",
        type: "Field",
        name: "VR",
        description: "Virtual reality headsets.",
      },
      { domain: "project", type: "Field", name: "Web Development" },
      { domain: "project", type: "Technology", name: "Python" },
      { domain: "project", type: "Technology", name: "Blockchain" },
    ])
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}

type Status = "draft" | "submitted" | "published" | "archived";

async function project(title: string, status: Status, categoryIds: string[]) {
  const [row] = await db
    .insert(projects)
    .values({ title, status })
    .returning({ id: projects.id });
  if (categoryIds.length > 0) {
    await db
      .insert(projectCategories)
      .values(
        categoryIds.map((categoryId) => ({ projectId: row.id, categoryId }))
      );
  }
  return row.id;
}

function handleIn(body: Record<string, unknown>, name: string): string {
  const input = body.input as { content: string }[];
  const line = input[0].content
    .split("\n")
    .find((l) => /^c\d+ /u.test(l) && l.slice(l.indexOf(" ") + 1) === name);
  return line?.split(" ")[0] ?? "c0";
}

/** A model that answers with what `build` returns, by category name. */
function fakeModel(
  build: (
    handle: (name: string) => string
  ) => Record<string, unknown> = () => ({})
): ResponsesFn {
  return vi.fn((body: Record<string, unknown>) =>
    Promise.resolve({
      status: "completed",
      output: [
        {
          type: "function_call",
          name: CLEANUP_TOOL_NAME,
          arguments: JSON.stringify({
            merges: [],
            renames: [],
            moves: [],
            retires: [],
            ...build((name) => handleIn(body, name)),
          }),
        },
      ],
      usage: { input_tokens: 4200, output_tokens: 900 },
    })
  );
}

const REASON = "One idea split across two checkboxes.";

const MERGE_VR = (h: (name: string) => string) => ({
  merges: [{ sources: [h("VR")], target: h("AR / VR"), reason: REASON }],
});

/** Every category and every link, for "nothing changed" comparisons. */
async function snapshot() {
  const cats = await db
    .select({
      id: categories.id,
      name: categories.name,
      type: categories.type,
      description: categories.description,
    })
    .from(categories)
    .orderBy(categories.id);
  const links = await db
    .select()
    .from(projectCategories)
    .orderBy(projectCategories.projectId, projectCategories.categoryId);
  return { cats, links };
}

async function namesOf(projectId: string) {
  const rows = await db
    .select({ name: categories.name })
    .from(projectCategories)
    .innerJoin(categories, eq(categories.id, projectCategories.categoryId))
    .where(eq(projectCategories.projectId, projectId));
  return rows.map((r) => r.name).sort();
}

function refOf(row: {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
}): CleanupCategoryRef {
  return {
    id: row.id,
    name: row.name,
    type: row.type ?? "",
    description: row.description,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proposing a cleanup", () => {
  it("refuses a caller who is not staff, on propose and on apply", async () => {
    const cats = await seedCategories();
    const proposer = await makeUser(`own-${Date.now()}@x.com`, "user");
    const model = fakeModel(MERGE_VR);
    const before = await snapshot();

    await expect(proposeCategoryCleanupAs(proposer, model)).rejects.toThrow();
    await expect(
      applyCategoryCleanupAs(proposer, {
        changes: [{ kind: "retire", category: refOf(cats.Blockchain) }],
      })
    ).rejects.toThrow();

    expect(model).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    expect(await db.select().from(aiReviewUsage)).toEqual([]);
  });

  it("sends each category's description, both counts and published titles only", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`prompt-${Date.now()}@x.com`, "admin");
    await project("Headset lab", "published", [cats.VR.id]);
    await project("Pending headset", "submitted", [cats.VR.id]);
    await project("Secret draft", "draft", [cats.VR.id]);
    const model = fakeModel();

    await proposeCategoryCleanupAs(admin, model);

    const body = vi.mocked(model).mock.calls[0][0];
    const input = (body.input as { content: string }[])[0].content;
    expect(body.store).toBe(false);
    expect(input).toContain("Virtual reality headsets.");
    expect(input).toContain("1 published, 2 submitted or later");
    expect(input).toContain('"Headset lab"');
    expect(input).not.toContain("Pending headset");
    expect(input).not.toContain("Secret draft");
    expect(input).toContain("Field 3");
  });

  it("changes no category and no project, and writes only the usage row", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`dry-${Date.now()}@x.com`, "admin");
    await project("Headset lab", "published", [cats.VR.id, cats["AR / VR"].id]);
    const before = await snapshot();

    const { proposals } = await proposeCategoryCleanupAs(
      admin,
      fakeModel(MERGE_VR)
    );

    expect(proposals).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
    const usage = await db.select().from(aiReviewUsage);
    expect(
      usage.map((r) => [r.userId, r.feature, r.projectId, r.outcome])
    ).toEqual([[admin.id, "categories", null, "ok"]]);
  });

  it("reads each change's effect from the current counts", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`effect-${Date.now()}@x.com`, "admin");
    await project("One", "published", [cats.VR.id]);
    await project("Two", "submitted", [cats.VR.id, cats["AR / VR"].id]);
    await project("Three", "published", [cats["AR / VR"].id]);
    await project("Four", "archived", [cats["AR / VR"].id]);
    // Not counted, as the admin table does not count it.
    await project("Draft", "draft", [cats.VR.id]);

    const { proposals } = await proposeCategoryCleanupAs(
      admin,
      fakeModel((h) => ({
        ...MERGE_VR(h),
        retires: [{ category: h("Blockchain"), reason: REASON }],
      }))
    );

    expect(proposals.map((p) => p.effect)).toEqual([
      { kind: "merge", targetUsage: 3, sourceUsage: [2], after: 4, shared: 1 },
      { kind: "retire", usage: 0 },
    ]);
  });

  it("counts against the caller's limit", async () => {
    await seedCategories();
    const admin = await makeUser(`limit-${Date.now()}@x.com`, "admin");
    vi.stubEnv("AI_CATEGORIES_LIMIT_PER_HOUR", "1");
    try {
      const model = fakeModel();
      await proposeCategoryCleanupAs(admin, model);
      await expect(proposeCategoryCleanupAs(admin, model)).rejects.toThrow(
        /category regenerations and cleanups/u
      );
      expect(model).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("meters a failed call and throws a sentence, not the error", async () => {
    await seedCategories();
    const admin = await makeUser(`down-${Date.now()}@x.com`, "admin");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      proposeCategoryCleanupAs(admin, () =>
        Promise.reject(new Error("Bedrock is down, token=abc"))
      )
    ).rejects.toThrow("Couldn't propose a cleanup. Try again.");

    expect(error).toHaveBeenCalled();
    const usage = await db.select().from(aiReviewUsage);
    expect(usage.map((r) => r.outcome)).toEqual(["failed"]);
  });
});

describe("applying a cleanup", () => {
  it("merges every link into the target once and deletes the sources", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`merge-${Date.now()}@x.com`, "admin");
    const only = await project("Only VR", "published", [cats.VR.id]);
    const both = await project("Both", "draft", [
      cats.VR.id,
      cats["AR / VR"].id,
      cats.Python.id,
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const { results } = await applyCategoryCleanupAs(admin, {
      changes: [
        {
          kind: "merge",
          target: refOf(cats["AR / VR"]),
          sources: [refOf(cats.VR)],
        },
      ],
    });

    expect(results).toEqual([{ ok: true }]);
    expect(await namesOf(only)).toEqual(["AR / VR"]);
    expect(await namesOf(both)).toEqual(["AR / VR", "Python"]);
    expect(
      await db.select().from(categories).where(eq(categories.id, cats.VR.id))
    ).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      `Category cleanup applied by ${admin.id}: merge ${cats.VR.id} into ${cats["AR / VR"].id}, 2 links removed, 1 added to the target`
    );
  });

  it("leaves every row as it was when a merge fails after moving links", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`rollback-${Date.now()}@x.com`, "admin");
    await project("Only VR", "published", [cats.VR.id]);
    await project("Both", "published", [cats.VR.id, cats["AR / VR"].id]);
    const before = await snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Fails the delete of the sources, the step after the links move.
    await db.execute(
      sql.raw(`create or replace function test_refuse_category_delete() returns trigger as $$
        begin raise exception 'refused by test'; end $$ language plpgsql`)
    );
    await db.execute(
      sql.raw(
        "create trigger test_refuse_category_delete before delete on categories for each row execute function test_refuse_category_delete()"
      )
    );
    try {
      const { results } = await applyCategoryCleanupAs(admin, {
        changes: [
          {
            kind: "merge",
            target: refOf(cats["AR / VR"]),
            sources: [refOf(cats.VR)],
          },
        ],
      });
      expect(results).toEqual([
        { ok: false, reason: "Couldn't apply this change. Try again." },
      ]);
    } finally {
      await db.execute(
        sql.raw("drop trigger test_refuse_category_delete on categories")
      );
      await db.execute(sql.raw("drop function test_refuse_category_delete()"));
    }
    expect(error).toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a rename onto a name the type already holds, with the index's message", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`collide-${Date.now()}@x.com`, "admin");

    const { results } = await applyCategoryCleanupAs(admin, {
      changes: [
        {
          kind: "rename",
          category: refOf(cats.VR),
          name: "ar / vr",
          description: null,
        },
        {
          kind: "move",
          category: refOf(cats["Web Development"]),
          type: "Technology",
        },
      ],
    });

    expect(results).toEqual([
      {
        ok: false,
        reason: 'A category named "AR / VR" already exists with type "Field".',
      },
      { ok: true },
    ]);
    const [vr] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, cats.VR.id));
    expect(vr.name).toBe("VR");
  });

  it("refuses a stale proposal with a reason and still applies the others", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`stale-${Date.now()}@x.com`, "admin");
    const { proposals } = await proposeCategoryCleanupAs(
      admin,
      fakeModel((h) => ({
        ...MERGE_VR(h),
        renames: [
          {
            category: h("Python"),
            name: "Python 3",
            description: null,
            reason: REASON,
          },
        ],
        moves: [
          {
            category: h("Web Development"),
            type: "Technology",
            reason: REASON,
          },
        ],
        retires: [{ category: h("Blockchain"), reason: REASON }],
      }))
    );
    // After the proposal a colleague deletes VR, rewrites Python's description
    // and renames Web Development, by hand.
    await db.delete(categories).where(eq(categories.id, cats.VR.id));
    await db
      .update(categories)
      .set({ description: "The language." })
      .where(eq(categories.id, cats.Python.id));
    await db
      .update(categories)
      .set({ name: "Web" })
      .where(eq(categories.id, cats["Web Development"].id));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { results } = await applyCategoryCleanupAs(admin, {
      changes: proposals.map((p) => p.operation),
    });

    expect(results).toEqual([
      { ok: false, reason: "VR no longer exists. Propose a cleanup again." },
      {
        ok: false,
        reason:
          "Python was edited after the proposal. Propose a cleanup again.",
      },
      {
        ok: false,
        reason:
          "Web Development was edited after the proposal. Propose a cleanup again.",
      },
      { ok: true },
    ]);
    const [web] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, cats["Web Development"].id));
    expect(web.type).toBe("Field");
    expect(
      await db
        .select()
        .from(categories)
        .where(eq(categories.id, cats.Blockchain.id))
    ).toEqual([]);
  });

  it("refuses what the tool would have refused the model", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`rules-${Date.now()}@x.com`, "admin");
    const before = await snapshot();

    const { results } = await applyCategoryCleanupAs(admin, {
      changes: [
        { kind: "retire", category: refOf(cats["New Build"]) },
        { kind: "move", category: refOf(cats.Python), type: "Kind of work" },
        { kind: "move", category: refOf(cats.Python), type: "Industry" },
        {
          kind: "merge",
          target: refOf(cats["Web Development"]),
          sources: [refOf(cats.Python)],
        },
        {
          kind: "merge",
          target: refOf(cats.VR),
          sources: [refOf(cats.VR)],
        },
      ],
    });

    expect(results.map((r) => r.ok)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(results).toMatchObject([
      { reason: expect.stringMatching(/Kind of work categories are fixed/u) },
      { reason: expect.stringMatching(/Nothing moves into Kind of work/u) },
      { reason: expect.stringMatching(/no Industry type/u) },
      { reason: expect.stringMatching(/keeps to one type/u) },
      { reason: expect.stringMatching(/one category twice/u) },
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a rename to the values the category already holds", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`same-${Date.now()}@x.com`, "admin");

    const { results } = await applyCategoryCleanupAs(admin, {
      changes: [
        {
          kind: "rename",
          category: refOf(cats.VR),
          name: "VR",
          description: "Virtual reality headsets.",
        },
      ],
    });

    expect(results).toEqual([
      { ok: false, reason: "This rename changes nothing." },
    ]);
  });
});

/**
 * A staff Save running beside a merge, the way `setProjectCategoriesAs`
 * writes: the project lock, the delete of the whole set, then the insert of
 * the new one, held open between the two until the merge is waiting.
 */
async function saveBesideMerge(
  projectId: string,
  newSet: string[],
  merge: () => Promise<unknown>
) {
  let deleted!: () => void;
  const ready = new Promise<void>((resolve) => {
    deleted = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = db.transaction(async (tx) => {
    await lockProjectCategories(tx, projectId);
    await tx
      .delete(projectCategories)
      .where(eq(projectCategories.projectId, projectId));
    deleted();
    await gate;
    await tx
      .insert(projectCategories)
      .values(newSet.map((categoryId) => ({ projectId, categoryId })));
  });
  await ready;
  const merged = merge();
  // Long enough for the merge to reach the lock it waits on.
  await new Promise((resolve) => setTimeout(resolve, 300));
  release();
  await save;
  return merged;
}

describe("applying a cleanup beside a staff Save", () => {
  it("waits for a Save that keeps the source, then moves its link", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`dead-${Date.now()}@x.com`, "admin");
    const id = await project("Kept", "published", [cats.VR.id]);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const applied = await saveBesideMerge(id, [cats.VR.id], () =>
      applyCategoryCleanupAs(admin, {
        changes: [
          {
            kind: "merge",
            target: refOf(cats["AR / VR"]),
            sources: [refOf(cats.VR)],
          },
        ],
      })
    );

    expect(applied).toEqual({ results: [{ ok: true }] });
    expect(await namesOf(id)).toEqual(["AR / VR"]);
  });

  it("does not copy a link the Save removed to the target", async () => {
    const cats = await seedCategories();
    const admin = await makeUser(`drop-${Date.now()}@x.com`, "admin");
    const id = await project("Dropped", "published", [cats.VR.id]);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await saveBesideMerge(id, [cats.Python.id], () =>
      applyCategoryCleanupAs(admin, {
        changes: [
          {
            kind: "merge",
            target: refOf(cats["AR / VR"]),
            sources: [refOf(cats.VR)],
          },
        ],
      })
    );

    expect(await namesOf(id)).toEqual(["Python"]);
  });
});
