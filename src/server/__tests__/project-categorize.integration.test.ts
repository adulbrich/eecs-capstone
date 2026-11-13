import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import {
  aiReviewUsage,
  categories,
  projectAiRefreshes,
  projectCategories,
  projects,
  user,
} from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { auth } from "#/lib/auth";
import { CATEGORIZE_TOOL_NAME } from "#/server/_internal/categorize-core";
import {
  approveProposedCategoryAs,
  categorizeProject,
  loadCategoryOptions,
  regenerateProjectCategoriesAs,
} from "#/server/_internal/project-categorize";
import { settleProjectRefreshes } from "#/server/_internal/project-refresh";
import {
  createProjectAs,
  performTransitionAs,
  softDeleteProjectAs,
} from "#/server/_internal/projects";

/**
 * The categorizer (#31) against the database. Every model call is a fake
 * `ResponsesFn` that reads the handles out of the catalog it was sent, so the
 * tests pick categories by name the way the model does by handle.
 */

beforeAll(() => {
  // Off for the rest of the suite (setup.integration.ts); every path here
  // injects its model, so nothing reaches the network.
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

function baseProject(title: string) {
  return {
    title,
    description: "A web app that helps nurses rehearse clinical cases.",
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    notes: null,
  };
}

/** The defaults the fakes pick from, a small slice of the real list. */
async function seedCategories() {
  const rows = await db
    .insert(categories)
    .values([
      { domain: "project", type: "Kind of work", name: "New Build" },
      { domain: "project", type: "Kind of work", name: "Research" },
      {
        domain: "project",
        type: "Field",
        name: "Web Development",
        description: "Web applications and the services behind them.",
      },
      { domain: "project", type: "Field", name: "Machine Learning" },
      { domain: "project", type: "Industry", name: "Healthcare" },
    ])
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

/** The handle the catalog in `body` gave the category named `name`. */
function handleIn(body: Record<string, unknown>, name: string): string {
  const input = body.input as { content: string }[];
  const line = input[0].content
    .split("\n")
    .find((l) => l.includes(` ${name} (`));
  return line?.split(" ")[0] ?? "c0";
}

/** A model that files the project under these names, by type. */
function fakeModel(
  picks: Record<string, string[]>,
  proposal?: unknown
): ResponsesFn {
  return vi.fn((body: Record<string, unknown>) => {
    const args: Record<string, unknown> = {};
    for (const [key, names] of Object.entries(picks)) {
      args[key] = names.map((n) => handleIn(body, n));
    }
    const tool = (body.tools as { parameters: { properties: object } }[])[0];
    for (const key of Object.keys(tool.parameters.properties)) {
      args[key] ??= key === "proposal" ? (proposal ?? null) : [];
    }
    return Promise.resolve({
      status: "completed",
      output: [
        {
          type: "function_call",
          name: CATEGORIZE_TOOL_NAME,
          arguments: JSON.stringify(args),
        },
      ],
      usage: { input_tokens: 2600, output_tokens: 60 },
    });
  });
}

const PICKS = {
  kind_of_work: ["New Build"],
  field: ["Web Development"],
  industry: ["Healthcare"],
};

const failing: ResponsesFn = () => Promise.reject(new Error("Bedrock is down"));

async function categoryNames(projectId: string) {
  const rows = await db
    .select({ name: categories.name })
    .from(projectCategories)
    .innerJoin(categories, eq(categories.id, projectCategories.categoryId))
    .where(eq(projectCategories.projectId, projectId));
  return rows.map((r) => r.name).sort();
}

async function attempt(projectId: string) {
  const [row] = await db
    .select()
    .from(projectAiRefreshes)
    .where(eq(projectAiRefreshes.projectId, projectId));
  return row ? { outcome: row.outcome, trigger: row.trigger } : null;
}

describe("the run on submit", () => {
  it("files a project that has no categories", async () => {
    await seedCategories();
    const admin = await makeUser(`sub-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Nursing cases"));
    const model = fakeModel(PICKS);

    await performTransitionAs(admin, id, "submitted", undefined, {
      categorize: model,
    });
    await settleProjectRefreshes();

    expect(await categoryNames(id)).toEqual([
      "Healthcare",
      "New Build",
      "Web Development",
    ]);
    expect(await attempt(id)).toEqual({
      outcome: "updated",
      trigger: "automatic",
    });
  });

  it("does nothing for a project that already has categories", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`has-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Already filed"));
    await db
      .insert(projectCategories)
      .values({ projectId: id, categoryId: ids.Research });
    const model = fakeModel(PICKS);

    await performTransitionAs(admin, id, "submitted", undefined, {
      categorize: model,
    });
    await settleProjectRefreshes();

    expect(model).not.toHaveBeenCalled();
    expect(await categoryNames(id)).toEqual(["Research"]);
  });

  it("leaves a project submitted and uncategorized when the model fails", async () => {
    await seedCategories();
    const admin = await makeUser(`fail-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await performTransitionAs(
      admin,
      id,
      "submitted",
      undefined,
      {
        categorize: failing,
      }
    );
    await settleProjectRefreshes();
    error.mockRestore();

    expect(result.status).toBe("submitted");
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("submitted");
    expect(await categoryNames(id)).toEqual([]);
    expect(await attempt(id)).toEqual({
      outcome: "failed",
      trigger: "automatic",
    });
  });

  it("writes nothing when staff set categories during the call", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`race-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Raced"));
    const answer = fakeModel(PICKS);
    const model: ResponsesFn = async (body) => {
      await db
        .insert(projectCategories)
        .values({ projectId: id, categoryId: ids["Machine Learning"] });
      return answer(body);
    };

    expect(await categorizeProject(id, model)).toBe("superseded");
    expect(await categoryNames(id)).toEqual(["Machine Learning"]);
  });

  it("meters against no one's limit", async () => {
    await seedCategories();
    const admin = await makeUser(`meter-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Unmetered"));

    await categorizeProject(id, fakeModel(PICKS));

    expect(await db.select().from(aiReviewUsage)).toEqual([]);
  });
});

describe("the prompt", () => {
  it("carries each category's description and its count of published projects", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`prompt-${Date.now()}@x.com`, "admin");
    const published = await createProjectAs(admin, baseProject("Live"));
    const draft = await createProjectAs(admin, baseProject("Draft"));
    await db
      .update(projects)
      .set({ status: "published" })
      .where(eq(projects.id, published.id));
    await db.insert(projectCategories).values([
      { projectId: published.id, categoryId: ids["Web Development"] },
      { projectId: draft.id, categoryId: ids["Web Development"] },
    ]);
    const { id } = await createProjectAs(admin, baseProject("Asks"));
    const model = fakeModel(PICKS);

    await categorizeProject(id, model);

    const body = vi.mocked(model).mock.calls[0][0] as {
      input: { content: string }[];
    };
    expect(body.input[0].content).toContain(
      "Web Development (1 project): Web applications and the services behind them."
    );
    const options = await loadCategoryOptions();
    expect(options.find((o) => o.name === "Web Development")?.usage).toBe(1);
  });
});

describe("Regenerate categories", () => {
  it("replaces the project's categories rather than merging", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`regen-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Redo"));
    await db.insert(projectCategories).values([
      { projectId: id, categoryId: ids.Research },
      { projectId: id, categoryId: ids["Machine Learning"] },
    ]);

    const result = await regenerateProjectCategoriesAs(
      admin,
      { projectId: id },
      fakeModel(PICKS)
    );

    expect(result.outcome).toBe("updated");
    expect(await categoryNames(id)).toEqual([
      "Healthcare",
      "New Build",
      "Web Development",
    ]);
    expect(await attempt(id)).toEqual({ outcome: "updated", trigger: "staff" });
  });

  it("counts against the staff member's limit", async () => {
    await seedCategories();
    const admin = await makeUser(`count-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Counted"));

    await regenerateProjectCategoriesAs(
      admin,
      { projectId: id },
      fakeModel(PICKS)
    );

    const rows = await db.select().from(aiReviewUsage);
    expect(rows.map((r) => [r.userId, r.feature])).toEqual([
      [admin.id, "categories"],
    ]);
  });

  it("works on a published project and refuses a deleted one", async () => {
    await seedCategories();
    const admin = await makeUser(`del-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await db
      .update(projects)
      .set({ status: "published" })
      .where(eq(projects.id, id));
    await regenerateProjectCategoriesAs(
      admin,
      { projectId: id },
      fakeModel(PICKS)
    );
    expect(await categoryNames(id)).toHaveLength(3);

    await softDeleteProjectAs(admin, id);
    const model = fakeModel(PICKS);
    await expect(
      regenerateProjectCategoriesAs(admin, { projectId: id }, model)
    ).rejects.toThrow(/Restore/u);
    expect(model).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not staff", async () => {
    await seedCategories();
    const proposer = await makeUser(`own-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(proposer, baseProject("Mine"));
    const model = fakeModel(PICKS);

    await expect(
      regenerateProjectCategoriesAs(proposer, { projectId: id }, model)
    ).rejects.toThrow();
    expect(model).not.toHaveBeenCalled();
  });

  it("keeps a colleague's save made during the call", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`col-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Raced"));
    const answer = fakeModel(PICKS);
    const model: ResponsesFn = async (body) => {
      await db
        .insert(projectCategories)
        .values({ projectId: id, categoryId: ids.Research });
      return answer(body);
    };

    const result = await regenerateProjectCategoriesAs(
      admin,
      { projectId: id },
      model
    );

    expect(result.outcome).toBe("superseded");
    expect(await categoryNames(id)).toEqual(["Research"]);
  });

  it("returns a proposal and writes nothing to categories", async () => {
    await seedCategories();
    const admin = await makeUser(`prop-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Novel"));
    const before = await db.select().from(categories);
    const proposal = {
      name: "Clinical Simulation",
      type: "Field",
      description: "Simulated clinical cases for training.",
      reason: "No Field covers clinical simulation.",
    };

    const result = await regenerateProjectCategoriesAs(
      admin,
      { projectId: id },
      fakeModel(PICKS, proposal)
    );

    expect(result.proposal).toEqual(proposal);
    expect(await db.select().from(categories)).toHaveLength(before.length);
  });

  it("throws and records a failed attempt when the model fails", async () => {
    await seedCategories();
    const admin = await makeUser(`rf-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      regenerateProjectCategoriesAs(admin, { projectId: id }, failing)
    ).rejects.toThrow(/categorize/u);
    error.mockRestore();

    expect(await attempt(id)).toEqual({ outcome: "failed", trigger: "staff" });
  });
});

describe("approving a proposed category", () => {
  it("creates it in the project domain and adds it to the project", async () => {
    const ids = await seedCategories();
    const admin = await makeUser(`ap-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Novel"));
    await db
      .insert(projectCategories)
      .values({ projectId: id, categoryId: ids["New Build"] });

    const { categoryId } = await approveProposedCategoryAs(admin, {
      projectId: id,
      name: "Clinical Simulation",
      type: "Field",
      description: "Simulated clinical cases for training.",
    });

    const [row] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId));
    expect(row).toMatchObject({
      domain: "project",
      type: "Field",
      name: "Clinical Simulation",
      description: "Simulated clinical cases for training.",
    });
    expect(await categoryNames(id)).toEqual([
      "Clinical Simulation",
      "New Build",
    ]);
  });

  it("refuses Kind of work and a type that does not exist", async () => {
    await seedCategories();
    const admin = await makeUser(`apt-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Typed"));

    for (const type of ["Kind of work", "Brand new type"]) {
      await expect(
        approveProposedCategoryAs(admin, {
          projectId: id,
          name: "Consulting",
          type,
          description: "x.",
        })
      ).rejects.toThrow(/existing type/u);
    }
  });

  it("refuses a name that already exists in that type, with the usual message", async () => {
    await seedCategories();
    const admin = await makeUser(`dup-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject("Dup"));

    await expect(
      approveProposedCategoryAs(admin, {
        projectId: id,
        name: "web development",
        type: "Field",
        description: "x.",
      })
    ).rejects.toThrow('A category named "Web Development" already exists');
  });

  it("refuses a caller who is not staff", async () => {
    await seedCategories();
    const proposer = await makeUser(`apn-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(proposer, baseProject("Mine"));

    await expect(
      approveProposedCategoryAs(proposer, {
        projectId: id,
        name: "Clinical Simulation",
        type: "Field",
        description: "x.",
      })
    ).rejects.toThrow();
    expect(await categoryNames(id)).toEqual([]);
  });
});
