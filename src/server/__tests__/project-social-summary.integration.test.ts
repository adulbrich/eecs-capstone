import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { auth } from "#/lib/auth";
import { settleProjectRefreshes } from "#/server/_internal/project-refresh";
import { refreshSocialSummary } from "#/server/_internal/project-social-summary";
import {
  createProjectAs,
  performTransitionAs,
  restoreProjectAs,
  softDeleteProjectAs,
  updateProjectAs,
} from "#/server/_internal/projects";
import { SOCIAL_SUMMARY_TOOL_NAME } from "#/server/_internal/social-summary-core";

/**
 * A fake `ResponsesFn` returning a well-formed tool call, so nothing here
 * reaches AWS. The same seam `refreshProjectEmbedding` uses for `embed`.
 */
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

/**
 * A model that answers only once `release` is called, standing in for a
 * stalled Bedrock call. `called` resolves when the refresh reaches it, which
 * is after it has read the row. Release it in a `finally`; if the code under
 * test awaits the held call, the `try` never finishes, this test times out
 * and the next test's drain hangs too, so read the first failure.
 */
function heldModel(summary: string) {
  let release: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const called = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const answer = fakeModel(summary);
  const model: ResponsesFn = async (body) => {
    reached();
    await gate;
    return answer(body);
  };
  return { model, release, called };
}

async function makeAdmin(email: string) {
  await auth.api.createUser({
    body: { email, name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

function baseProject(title: string) {
  return {
    title,
    description: "A rover that streams sensor data.",
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

/**
 * Threads a fake model through the `summarize` seam on every transition, so
 * publishing exercises the real call site in `projects.ts` without reaching
 * Bedrock. Passing nothing here would leave the wiring untested and send the
 * suite at AWS.
 */
async function publish(
  admin: { id: string; role: string | null },
  id: string,
  summarize: ResponsesFn = fakeModel("Published by the call site.")
) {
  await performTransitionAs(admin, id, "submitted", undefined, { summarize });
  await performTransitionAs(admin, id, "approved", undefined, { summarize });
  await performTransitionAs(admin, id, "published", undefined, { summarize });
  await settleProjectRefreshes();
}

async function readRow(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}

let seq = 0;
const nextEmail = () => `soc-${Date.now()}-${seq++}@x.com`;

/**
 * `vitest.integration.config.ts` switches social summaries off for the whole
 * run, so no other file can reach Bedrock by publishing something. This file
 * is the exception and turns it on for itself; every path below injects a
 * fake, so it still reaches no network.
 */
beforeAll(() => {
  process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED = "true";
});

afterAll(() => {
  process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED = "false";
});

describe("refreshSocialSummary", () => {
  it("skips a draft without calling the model", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Draft"));
    const model = fakeModel("Never written.");

    expect(await refreshSocialSummary(id, model)).toBe("skipped");
    expect(model).not.toHaveBeenCalled();
    expect((await readRow(id)).socialSummary).toBeNull();
  });

  it("is written by publishing, without a direct call", async () => {
    // The call site in projects.ts, not this module in isolation: getting the
    // wiring wrong gives you a project that publishes and never summarises.
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Rover"));
    await publish(admin, id, fakeModel("A rover that streams sensor data."));

    const row = await readRow(id);
    expect(row.socialSummary).toBe("A rover that streams sensor data.");
    expect(row.socialSummarySourceHash).toBeTruthy();
    expect(row.socialSummaryUpdatedAt).toBeInstanceOf(Date);
    expect(row.socialSummaryIsManual).toBe(false);
  });

  it("does not call the model again when the source text has not moved", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Stable"));
    await publish(admin, id, fakeModel("First pass."));

    const second = fakeModel("Second pass.");
    expect(await refreshSocialSummary(id, second)).toBe("unchanged");
    expect(second).not.toHaveBeenCalled();
    expect((await readRow(id)).socialSummary).toBe("First pass.");
  });

  it("regenerates when the description changes", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Moving"));
    await publish(admin, id, fakeModel("Before."));

    await updateProjectAs(
      admin,
      { ...baseProject("Moving"), id, description: "Now it streams video." },
      undefined,
      fakeModel("After.")
    );
    await settleProjectRefreshes();
    expect((await readRow(id)).socialSummary).toBe("After.");
  });

  it("does not regenerate when a field outside the source changes", async () => {
    // The hash covers title, description and problem statement only, so
    // editing anything else must not spend a model call.
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Untouched"));
    await publish(admin, id, fakeModel("Original wording."));

    const model = fakeModel("Should never be written.");
    await updateProjectAs(
      admin,
      { ...baseProject("Untouched"), id, minQualifications: "Some Python." },
      undefined,
      model
    );
    await settleProjectRefreshes();
    expect(model).not.toHaveBeenCalled();
    expect((await readRow(id)).socialSummary).toBe("Original wording.");
  });

  it("never overwrites a summary staff wrote by hand", async () => {
    // The whole reason the flag exists: a hash detects that the source text
    // changed, not that a human deliberately wrote what is stored.
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Manual"));
    await publish(admin, id, fakeModel("Model wording."));
    await db
      .update(projects)
      .set({
        socialSummary: "Wording staff chose.",
        socialSummaryIsManual: true,
      })
      .where(eq(projects.id, id));

    const model = fakeModel("Replacement the model wanted.");
    await updateProjectAs(
      admin,
      { ...baseProject("Manual"), id, description: "Completely different." },
      undefined,
      model
    );
    await settleProjectRefreshes();
    expect(model).not.toHaveBeenCalled();
    expect((await readRow(id)).socialSummary).toBe("Wording staff chose.");
    expect(await refreshSocialSummary(id, model)).toBe("manual");
  });

  it("does not clobber a staff save that lands while the model is thinking", async () => {
    // The window the manual flag alone does not close: the flag is read before
    // the model call and the write happens after it, so a save landing in
    // between was overwritten by text the model had already started producing,
    // while the flag stayed true and froze the row out of every later refresh.
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Racing"));
    await publish(admin, id, fakeModel("Original."));

    // A model that performs the staff save while it is "thinking", so the
    // interleaving is deterministic rather than a matter of timing.
    const racing: ResponsesFn = async () => {
      await db
        .update(projects)
        .set({
          socialSummary: "Wording staff chose mid-flight.",
          socialSummaryIsManual: true,
        })
        .where(eq(projects.id, id));
      return {
        status: "completed",
        output: [
          {
            type: "function_call",
            name: SOCIAL_SUMMARY_TOOL_NAME,
            arguments: JSON.stringify({ summary: "Model text." }),
          },
        ],
      };
    };

    await updateProjectAs(
      admin,
      { ...baseProject("Racing"), id, description: "Changed text." },
      undefined,
      racing
    );
    await settleProjectRefreshes();

    const row = await readRow(id);
    expect(row.socialSummary).toBe("Wording staff chose mid-flight.");
    expect(row.socialSummaryIsManual).toBe(true);
  });

  it("leaves the project published with a null summary when the model fails", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Outage"));
    await publish(admin, id, failing);

    const row = await readRow(id);
    expect(row.status).toBe("published");
    expect(row.socialSummary).toBeNull();
    // No hash either, so a later sweep retries rather than reading the row as
    // current and moving on.
    expect(row.socialSummarySourceHash).toBeNull();
  });

  it("retries a project whose earlier generation failed", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Retry"));
    await publish(admin, id, failing);

    expect(await refreshSocialSummary(id, fakeModel("Second try."))).toBe(
      "updated"
    );
    expect((await readRow(id)).socialSummary).toBe("Second try.");
  });

  it("rejects a summary over the cap rather than storing a clipped one", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("TooLong"));
    await publish(admin, id, fakeModel("x".repeat(400)));

    expect((await readRow(id)).socialSummary).toBeNull();
  });

  it("answers a save before the model does, then applies the summary", async () => {
    // Production held a save's response for 301 s on a stalled Mantle call,
    // with the row already committed, so the button never left "Saving...".
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Stalled edit"));
    await publish(admin, id, fakeModel("Before."));

    const { model, release } = heldModel("After.");
    try {
      expect(
        await updateProjectAs(
          admin,
          { ...baseProject("Stalled edit"), id, description: "New text." },
          undefined,
          model
        )
      ).toEqual({ id, updated: true });
      expect((await readRow(id)).socialSummary).toBe("Before.");
    } finally {
      release();
    }
    await settleProjectRefreshes();
    expect((await readRow(id)).socialSummary).toBe("After.");
  });

  it("answers a publish before the model does, then applies the summary", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Stalled publish"));
    await performTransitionAs(admin, id, "submitted");
    await performTransitionAs(admin, id, "approved");

    const { model, release } = heldModel("Published late.");
    try {
      await performTransitionAs(admin, id, "published", undefined, {
        summarize: model,
      });
      expect((await readRow(id)).socialSummary).toBeNull();
    } finally {
      release();
    }
    await settleProjectRefreshes();
    expect((await readRow(id)).socialSummary).toBe("Published late.");
  });

  it("keeps the last save's summary when a second save lands during the first's model call", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Overlap"));
    await publish(admin, id, fakeModel("Before."));

    const { model, release, called } = heldModel("Of the first text.");
    try {
      await updateProjectAs(
        admin,
        { ...baseProject("Overlap"), id, description: "First text." },
        undefined,
        model
      );
      // The first refresh has read "First text." before the second commits.
      await called;
      await updateProjectAs(
        admin,
        { ...baseProject("Overlap"), id, description: "Second text." },
        undefined,
        fakeModel("Of the second text.")
      );
    } finally {
      release();
    }
    await settleProjectRefreshes();
    expect((await readRow(id)).socialSummary).toBe("Of the second text.");
  });

  it("writes nothing when the text changes during the model call, as a save on another task would", async () => {
    // The queue orders refreshes on one task only. On two, the slower refresh
    // would otherwise pair the newer text with a summary of the older.
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Two tasks"));
    await publish(admin, id, fakeModel("Before."));
    await db
      .update(projects)
      .set({ description: "Text the model is shown." })
      .where(eq(projects.id, id));

    const editsMidCall: ResponsesFn = async (body) => {
      await db
        .update(projects)
        .set({ description: "Text saved during the call." })
        .where(eq(projects.id, id));
      return fakeModel("Of the text the model was shown.")(body);
    };

    expect(await refreshSocialSummary(id, editsMidCall)).toBe("superseded");
    expect((await readRow(id)).socialSummary).toBe("Before.");
  });

  it("loses to a Regenerate that lands during the model call", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Regenerated"));
    await publish(admin, id, fakeModel("Before."));
    await db
      .update(projects)
      .set({ description: "Changed text." })
      .where(eq(projects.id, id));

    const regeneratesMidCall: ResponsesFn = async (body) => {
      await db
        .update(projects)
        .set({ socialSummary: "What Regenerate wrote." })
        .where(eq(projects.id, id));
      return fakeModel("What the background refresh wrote.")(body);
    };

    expect(await refreshSocialSummary(id, regeneratesMidCall)).toBe(
      "superseded"
    );
    expect((await readRow(id)).socialSummary).toBe("What Regenerate wrote.");
  });

  it("refreshes a restored project, whose text may have moved while every refresh skipped it", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Restored"));
    await publish(admin, id, fakeModel("Before."));
    await softDeleteProjectAs(admin, id);
    // Stands in for the edit whose refresh found the row deleted and skipped.
    await db
      .update(projects)
      .set({ description: "Text that changed while it was deleted." })
      .where(eq(projects.id, id));

    await restoreProjectAs(admin, id, {
      summarize: fakeModel("Of the text it came back with."),
    });
    await settleProjectRefreshes();

    expect((await readRow(id)).socialSummary).toBe(
      "Of the text it came back with."
    );
  });

  it("skips while the kill switch is off", async () => {
    const admin = await makeAdmin(nextEmail());
    const { id } = await createProjectAs(admin, baseProject("Switched off"));
    await publish(admin, id, fakeModel("Written while on."));

    try {
      process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED = "false";
      const model = fakeModel("Never written.");
      expect(await refreshSocialSummary(id, model)).toBe("skipped");
      expect(model).not.toHaveBeenCalled();
    } finally {
      process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED = "true";
    }
  });
});
