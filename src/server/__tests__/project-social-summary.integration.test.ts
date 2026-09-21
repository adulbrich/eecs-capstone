import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { auth } from "#/lib/auth";
import { refreshSocialSummary } from "#/server/_internal/project-social-summary";
import {
  createProjectAs,
  performTransitionAs,
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

async function makeAdmin(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
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
