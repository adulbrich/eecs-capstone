import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { aiReviewUsage, projects, user } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { auth } from "#/lib/auth";
import { SOCIAL_SUMMARY_MAX_LENGTH } from "#/lib/social-summary";
import {
  getSocialSummaryAs,
  regenerateSocialSummaryAs,
  saveSocialSummaryAs,
} from "../_internal/social-summary";
import { SOCIAL_SUMMARY_TOOL_NAME } from "../_internal/social-summary-core";

/**
 * The staff write surface, driven through the `*As` seam.
 *
 * `project-social-summary.integration.test.ts` covers the automatic writer.
 * This file covers the three things staff can do, which had no test at all:
 * `access-contract.test.ts` declares the endpoints staff-only through an AST
 * scan and never calls them, the accessibility scan reaches `getSocialSummary`
 * and asserts nothing because the panel renders the same textarea on a 403,
 * and every component test mocks the module away. Removing all three
 * `assertStaff` calls left the suite green (#568).
 *
 * Every guard below is meant to fail at least one test in this file when it is
 * deleted. `correctness-review --mutate` is what checks that claim.
 */

const EMOJI = "\u{1F600}";

/** A fake `ResponsesFn` returning a well-formed tool call, so nothing reaches AWS. */
function fakeModel(summary: string): ResponsesFn {
  return vi.fn(() =>
    Promise.resolve({
      status: "completed",
      output: [
        {
          type: "function_call",
          name: SOCIAL_SUMMARY_TOOL_NAME,
          arguments: JSON.stringify({ summary }),
        },
      ],
    })
  );
}

const failing: ResponsesFn = () => Promise.reject(new Error("Bedrock is down"));

let seq = 0;
const nextEmail = () => `sss-${Date.now()}-${seq++}@x.com`;

async function makeUser(role: "user" | "admin") {
  const email = nextEmail();
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

async function makeProject(
  over: Partial<typeof projects.$inferInsert> = {},
  proposerId?: string
) {
  const [project] = await db
    .insert(projects)
    .values({
      title: "Rover",
      description: "A rover that streams sensor data.",
      status: "published",
      proposerId: proposerId ?? null,
      ...over,
    })
    .returning();
  return project;
}

async function readRow(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}

function usageRowsFor(userId: string) {
  return db
    .select()
    .from(aiReviewUsage)
    .where(eq(aiReviewUsage.userId, userId));
}

afterEach(() => {
  delete process.env.AI_SOCIAL_SUMMARY_LIMIT_PER_HOUR;
  delete process.env.AI_SOCIAL_SUMMARY_LIMIT_PER_DAY;
});

describe("the staff summary endpoints are staff only", () => {
  it("refuses a read from a signed-in student", async () => {
    const student = await makeUser("user");
    const project = await makeProject({}, student.id);

    await expect(
      getSocialSummaryAs(student, { projectId: project.id })
    ).rejects.toThrow(/Forbidden/);
  });

  it("refuses a save from a signed-in student, even on their own project", async () => {
    // Owning the project is not the question. The summary ships publicly under
    // the university's name, so writing it is a review action.
    const student = await makeUser("user");
    const project = await makeProject({}, student.id);

    await expect(
      saveSocialSummaryAs(student, {
        projectId: project.id,
        summary: "Wording the proposer preferred.",
      })
    ).rejects.toThrow(/Forbidden/);
    expect((await readRow(project.id)).socialSummary).toBeNull();
  });

  it("refuses a regenerate from a student without spending a model call", async () => {
    const student = await makeUser("user");
    const project = await makeProject({}, student.id);
    const model = fakeModel("Never written.");

    await expect(
      regenerateSocialSummaryAs(student, { projectId: project.id }, model)
    ).rejects.toThrow(/Forbidden/);
    expect(model).not.toHaveBeenCalled();
    expect(await usageRowsFor(student.id)).toHaveLength(0);
  });

  it("lets staff read one", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject({ socialSummary: "Stored wording." });

    expect(await getSocialSummaryAs(staff, { projectId: project.id })).toEqual({
      summary: "Stored wording.",
      updatedAt: null,
      isManual: false,
    });
  });
});

describe("saveSocialSummaryAs", () => {
  it("stores the trimmed wording and marks it manual", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject();

    const view = await saveSocialSummaryAs(staff, {
      projectId: project.id,
      summary: "  Wording staff chose.  ",
    });

    expect(view.summary).toBe("Wording staff chose.");
    const row = await readRow(project.id);
    expect(row.socialSummary).toBe("Wording staff chose.");
    expect(row.socialSummaryIsManual).toBe(true);
  });

  it("refuses an empty save rather than clearing the column", async () => {
    // Clearing is what Regenerate is for. An empty save would make a blank
    // og:description reachable deliberately rather than only through an outage.
    const staff = await makeUser("admin");
    const project = await makeProject({ socialSummary: "Stored wording." });

    await expect(
      saveSocialSummaryAs(staff, { projectId: project.id, summary: "   " })
    ).rejects.toThrow(/cannot be empty/);
    expect((await readRow(project.id)).socialSummary).toBe("Stored wording.");
  });

  it("refuses a save over the cap", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject();

    await expect(
      saveSocialSummaryAs(staff, {
        projectId: project.id,
        summary: "x".repeat(SOCIAL_SUMMARY_MAX_LENGTH + 1),
      })
    ).rejects.toThrow(/at most 300 characters/);
    expect((await readRow(project.id)).socialSummary).toBeNull();
  });

  it("accepts 151 emoji, which the schema and the panel also accept", async () => {
    // The cap counted one way (#565). This text is 302 UTF-16 code units and
    // 151 code points, and used to be accepted by the schema and refused here.
    const staff = await makeUser("admin");
    const project = await makeProject();
    const summary = EMOJI.repeat(151);

    await expect(
      saveSocialSummaryAs(staff, { projectId: project.id, summary })
    ).resolves.toMatchObject({ summary });
  });

  it("refuses a project that does not exist", async () => {
    const staff = await makeUser("admin");
    await expect(
      getSocialSummaryAs(staff, {
        projectId: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow(/not found/);
  });
});

describe("regenerateSocialSummaryAs", () => {
  it("writes the model's answer and hands the row back to the automatic path", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject({
      socialSummary: "Wording staff chose.",
      socialSummaryIsManual: true,
    });

    const result = await regenerateSocialSummaryAs(
      staff,
      { projectId: project.id },
      fakeModel("A rover that streams sensor data.")
    );

    // The case the guard must not break: Regenerate exists to take a manual
    // row back, so a predicate excluding manual rows would make this a no-op.
    expect(result).toMatchObject({
      outcome: "rewritten",
      isManual: false,
      summary: "A rover that streams sensor data.",
    });
    const row = await readRow(project.id);
    expect(row.socialSummary).toBe("A rover that streams sensor data.");
    expect(row.socialSummaryIsManual).toBe(false);
    expect(row.socialSummarySourceHash).toBeTruthy();
  });

  it("refuses a project with no text to summarise, before spending", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject({
      title: "   ",
      description: null,
      problemStatement: null,
    });
    const model = fakeModel("Never written.");

    await expect(
      regenerateSocialSummaryAs(staff, { projectId: project.id }, model)
    ).rejects.toThrow(/no title, description or problem statement/);
    expect(model).not.toHaveBeenCalled();
    expect(await usageRowsFor(staff.id)).toHaveLength(0);
  });

  it("stops at the hourly limit before the paid call", async () => {
    process.env.AI_SOCIAL_SUMMARY_LIMIT_PER_HOUR = "2";
    const staff = await makeUser("admin");
    const project = await makeProject();

    await regenerateSocialSummaryAs(
      staff,
      { projectId: project.id },
      fakeModel("One.")
    );
    await regenerateSocialSummaryAs(
      staff,
      { projectId: project.id },
      fakeModel("Two.")
    );

    const third = fakeModel("Three.");
    await expect(
      regenerateSocialSummaryAs(staff, { projectId: project.id }, third)
    ).rejects.toThrow(/for this hour/);
    // The limiter saves money rather than reporting an error afterwards.
    expect(third).not.toHaveBeenCalled();
    expect(await usageRowsFor(staff.id)).toHaveLength(2);
    expect((await readRow(project.id)).socialSummary).toBe("Two.");
  });

  it("throws on a failed run, leaves the row alone and still records the spend", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject({
      socialSummary: "Wording staff chose.",
      socialSummaryIsManual: true,
    });

    await expect(
      regenerateSocialSummaryAs(staff, { projectId: project.id }, failing)
    ).rejects.toThrow(/Bedrock is down/);

    const row = await readRow(project.id);
    expect(row.socialSummary).toBe("Wording staff chose.");
    expect(row.socialSummaryIsManual).toBe(true);
    // A failed attempt is billed all the same, so it is metered all the same.
    const rows = await usageRowsFor(staff.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("failed");
  });

  it("treats a blank model answer as a failure rather than billing it as ok", async () => {
    // `{"summary":"   "}` passed `.min(1)` on the untrimmed value and reached
    // the caller as an empty string with outcome ok, so the usage row said the
    // call succeeded while staff were shown the generic failure (#565).
    const staff = await makeUser("admin");
    const project = await makeProject();

    await expect(
      regenerateSocialSummaryAs(
        staff,
        { projectId: project.id },
        fakeModel("   ")
      )
    ).rejects.toThrow();

    const rows = await usageRowsFor(staff.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("failed");
    expect((await readRow(project.id)).socialSummary).toBeNull();
  });

  it("refuses an over-cap answer rather than storing a clipped one", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject();

    await expect(
      regenerateSocialSummaryAs(
        staff,
        { projectId: project.id },
        fakeModel("x".repeat(SOCIAL_SUMMARY_MAX_LENGTH + 1))
      )
    ).rejects.toThrow();
    expect((await readRow(project.id)).socialSummary).toBeNull();
  });

  it("records exactly one usage row for one successful rewrite", async () => {
    const staff = await makeUser("admin");
    const project = await makeProject();

    await regenerateSocialSummaryAs(
      staff,
      { projectId: project.id },
      fakeModel("A rover.")
    );

    const rows = await usageRowsFor(staff.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe("social-summary");
    expect(rows[0].outcome).toBe("ok");
    expect(rows[0].projectId).toBe(project.id);
  });
});

/**
 * The race #564 is about. The model call takes seconds, so the row this
 * function read at the top is not necessarily the row it writes to at the
 * bottom, and the write used to name only the project id.
 *
 * Each fake performs the competing save while it is "thinking", so the
 * interleaving is deterministic rather than a matter of timing.
 */
describe("regenerateSocialSummaryAs against a save that lands mid-flight", () => {
  function racingModel(summary: string, save: () => Promise<unknown>) {
    const model: ResponsesFn = async () => {
      await save();
      return {
        status: "completed",
        output: [
          {
            type: "function_call",
            name: SOCIAL_SUMMARY_TOOL_NAME,
            arguments: JSON.stringify({ summary }),
          },
        ],
      };
    };
    return model;
  }

  it("writes nothing when the project's text changes mid-call, leaving it to the edit's own refresh", async () => {
    // The edit's background refresh reads the newer text (ADR-0053); a summary
    // of the older one must not beat it, or nothing would ever redo it.
    const staff = await makeUser("admin");
    const project = await makeProject({ socialSummary: "Generated wording." });

    const result = await regenerateSocialSummaryAs(
      staff,
      { projectId: project.id },
      racingModel("A summary of the older text.", () =>
        db
          .update(projects)
          .set({ description: "What the proposer saved mid-call." })
          .where(eq(projects.id, project.id))
      )
    );

    expect(result.outcome).toBe("changed");
    expect((await readRow(project.id)).socialSummary).toBe(
      "Generated wording."
    );
  });

  it("keeps a save that landed on an automatic row, and says the row changed", async () => {
    const alice = await makeUser("admin");
    const bob = await makeUser("admin");
    const project = await makeProject({ socialSummary: "Generated wording." });

    const result = await regenerateSocialSummaryAs(
      alice,
      { projectId: project.id },
      racingModel("Model text nobody keeps.", () =>
        saveSocialSummaryAs(bob, {
          projectId: project.id,
          summary: "Wording Bob typed.",
        })
      )
    );

    expect(result.outcome).toBe("changed");
    expect(result.summary).toBe("Wording Bob typed.");
    expect(result.isManual).toBe(true);
    const row = await readRow(project.id);
    expect(row.socialSummary).toBe("Wording Bob typed.");
    expect(row.socialSummaryIsManual).toBe(true);
  });

  it("keeps a save that landed on a row that was already manual", async () => {
    // The case comparing the flag alone cannot see: the flag is true on both
    // sides of the race, so only the stored text tells them apart.
    const alice = await makeUser("admin");
    const bob = await makeUser("admin");
    const project = await makeProject({
      socialSummary: "Wording Alice typed earlier.",
      socialSummaryIsManual: true,
    });

    const result = await regenerateSocialSummaryAs(
      alice,
      { projectId: project.id },
      racingModel("Model text nobody keeps.", () =>
        saveSocialSummaryAs(bob, {
          projectId: project.id,
          summary: "Wording Bob typed.",
        })
      )
    );

    expect(result.outcome).toBe("changed");
    expect((await readRow(project.id)).socialSummary).toBe(
      "Wording Bob typed."
    );
    expect((await readRow(project.id)).socialSummaryIsManual).toBe(true);
  });

  it("still meters the lost race, because the call was paid for", async () => {
    const alice = await makeUser("admin");
    const bob = await makeUser("admin");
    const project = await makeProject({ socialSummary: "Generated wording." });

    await regenerateSocialSummaryAs(
      alice,
      { projectId: project.id },
      racingModel("Model text nobody keeps.", () =>
        saveSocialSummaryAs(bob, {
          projectId: project.id,
          summary: "Wording Bob typed.",
        })
      )
    );

    expect(await usageRowsFor(alice.id)).toHaveLength(1);
  });
});
