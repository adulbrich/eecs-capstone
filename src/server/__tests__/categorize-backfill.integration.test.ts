import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import {
  categorizeNextAs,
  countUncategorizedAs,
} from "#/server/_internal/categorize-backfill";
import { CATEGORIZE_TOOL_NAME } from "#/server/_internal/categorize-core";

/**
 * The categorization backfill (#31): which projects it picks, that a run
 * resumes, that a failure does not stall it, and that it meters against no
 * one. Every model call is a fake that files the project as New Build and
 * Web Development, by reading their handles out of the catalog it was sent.
 */

beforeAll(() => {
  process.env.BEDROCK_CATEGORIES_ENABLED = "true";
});

afterAll(() => {
  process.env.BEDROCK_CATEGORIES_ENABLED = "false";
});

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
      { domain: "project", type: "Field", name: "Web Development" },
    ])
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

function handleIn(body: Record<string, unknown>, name: string): string {
  const input = body.input as { content: string }[];
  const line = input[0].content
    .split("\n")
    .find((l) => l.includes(` ${name} (`));
  return line?.split(" ")[0] ?? "c0";
}

function fakeModel(): ResponsesFn {
  return vi.fn((body: Record<string, unknown>) =>
    Promise.resolve({
      status: "completed",
      output: [
        {
          type: "function_call",
          name: CATEGORIZE_TOOL_NAME,
          arguments: JSON.stringify({
            kind_of_work: [handleIn(body, "New Build")],
            field: [handleIn(body, "Web Development")],
          }),
        },
      ],
    })
  );
}

const failing: ResponsesFn = () => Promise.reject(new Error("Bedrock is down"));

type Status = "draft" | "submitted" | "published" | "archived";

async function project(
  title: string,
  status: Status,
  extra: { deletedAt?: Date } = {}
) {
  const [row] = await db
    .insert(projects)
    .values({ title, status, ...extra })
    .returning({ id: projects.id });
  return row.id;
}

async function categorized(id: string) {
  const rows = await db
    .select()
    .from(projectCategories)
    .where(eq(projectCategories.projectId, id));
  return rows.length;
}

/** Runs the backfill the way the dialog does, until it says it is done. */
async function runToEnd(
  admin: { id: string; role: string | null },
  model: ResponsesFn
) {
  const outcomes: string[] = [];
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const step = await categorizeNextAs(admin, { after }, model);
    if (step.done) {
      return outcomes;
    }
    outcomes.push(step.outcome);
    after = step.projectId;
  }
  throw new Error("the backfill did not finish");
}

describe("the categorization backfill", () => {
  it("picks only published or archived projects with no categories", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`bf-${Date.now()}@x.com`, "admin");
    const published = await project("Published", "published");
    const archived = await project("Archived", "archived");
    const draft = await project("Draft", "draft");
    const submitted = await project("Submitted", "submitted");
    const deleted = await project("Deleted", "published", {
      deletedAt: new Date(),
    });
    const filed = await project("Filed", "published");
    await db
      .insert(projectCategories)
      .values({ projectId: filed, categoryId: ids["Web Development"] });

    expect(await countUncategorizedAs(admin)).toEqual({ count: 2 });
    expect(await runToEnd(admin, fakeModel())).toEqual(["updated", "updated"]);

    expect(await categorized(published)).toBe(2);
    expect(await categorized(archived)).toBe(2);
    for (const untouched of [draft, submitted, deleted]) {
      expect(await categorized(untouched)).toBe(0);
    }
    expect(await categorized(filed)).toBe(1);
  });

  it("writes nothing on a second pass over a categorized catalog", async () => {
    await seedCategories();
    const admin = await makeUser(`bf2-${Date.now()}@x.com`, "admin");
    await project("One", "published");
    await runToEnd(admin, fakeModel());
    const model = fakeModel();

    expect(await runToEnd(admin, model)).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect(await countUncategorizedAs(admin)).toEqual({ count: 0 });
  });

  it("moves past a project the model fails on, and the next run retries it", async () => {
    await seedCategories();
    const admin = await makeUser(`bf3-${Date.now()}@x.com`, "admin");
    const a = await project("A", "published");
    const b = await project("B", "published");
    const [first] = [a, b].sort();
    let calls = 0;
    const flaky: ResponsesFn = (body) => {
      calls += 1;
      return calls === 1 ? failing(body) : fakeModel()(body);
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runToEnd(admin, flaky)).toEqual(["failed", "updated"]);
    error.mockRestore();
    expect(await categorized(first)).toBe(0);

    expect(await runToEnd(admin, fakeModel())).toEqual(["updated"]);
    expect(await categorized(first)).toBe(2);
  });

  it("meters against no one's limit", async () => {
    await seedCategories();
    const admin = await makeUser(`bf4-${Date.now()}@x.com`, "admin");
    await project("Unmetered", "published");

    await runToEnd(admin, fakeModel());

    expect(await db.select().from(aiReviewUsage)).toEqual([]);
  });

  it("refuses a caller who is not staff", async () => {
    await seedCategories();
    const u = await makeUser(`bf5-${Date.now()}@x.com`, "user");
    await project("Public", "published");
    const model = fakeModel();

    await expect(countUncategorizedAs(u)).rejects.toThrow();
    await expect(categorizeNextAs(u, { after: null }, model)).rejects.toThrow();
    expect(model).not.toHaveBeenCalled();
  });

  it("stops with a reason when the list loses its last Field mid-run", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`bf7-${Date.now()}@x.com`, "admin");
    await project("Stranded", "published");
    await db
      .delete(categories)
      .where(eq(categories.id, ids["Web Development"]));
    const model = fakeModel();

    await expect(
      categorizeNextAs(admin, { after: null }, model)
    ).rejects.toThrow(/at least one Field/u);
    expect(model).not.toHaveBeenCalled();
  });

  it("refuses to run while the kill switch is off", async () => {
    await seedCategories();
    const admin = await makeUser(`bf6-${Date.now()}@x.com`, "admin");
    await project("Off", "published");
    process.env.BEDROCK_CATEGORIES_ENABLED = "false";
    try {
      await expect(
        categorizeNextAs(admin, { after: null }, fakeModel())
      ).rejects.toThrow(/turned off/u);
    } finally {
      process.env.BEDROCK_CATEGORIES_ENABLED = "true";
    }
  });
});
