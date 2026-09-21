import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANTLE_REASONING_EFFORTS } from "#/lib/_internal/bedrock-mantle";
import { buildReviewConfig } from "#/server/_internal/project-review-core";
import { buildScopeConfig } from "#/server/_internal/scope-assessment-core";
import { buildSocialSummaryConfig } from "#/server/_internal/social-summary-core";

/**
 * Every reasoning effort this repo can send, checked against the set Mantle
 * accepts.
 *
 * This exists because of a production failure on 2026-09-21. The social
 * summary shipped with `minimal`, which is a valid OpenAI API value and one
 * Mantle's model rejects with a 400 naming its own six, so every call failed
 * from the moment it deployed. The automatic path swallows its errors by
 * design, so nothing was loud: publishes succeeded, `og:description` fell back
 * to the description, and the feature was simply absent.
 *
 * The reason no existing test caught it is the point of this file. The unit
 * tests mock the endpoint, so any string passes them. `env-contract.test.ts`
 * checks that a variable is present in the task definition, not that its value
 * is one the model takes. And the value production ran was never the default
 * in `src` at all: the task definition sets the variable explicitly, so
 * `env.BEDROCK_SOCIAL_SUMMARY_REASONING_EFFORT ?? "medium"` never reaches its
 * fallback there. The broken value lived in `infra/variables.tf`, which no
 * test read.
 *
 * So this checks all three places a value can come from, and would have failed
 * at commit on the one that mattered.
 */

const VARIABLES_TF = "infra/variables.tf";
const ENV_EXAMPLE = ".env.example";

/** `variable "bedrock_scope_reasoning_effort" { ... default = "high" }` */
const TF_EFFORT_VARIABLE =
  /variable\s+"([a-z0-9_]*reasoning_effort)"\s*\{[^}]*?default\s*=\s*"([^"]*)"/g;
/** `BEDROCK_SCOPE_REASONING_EFFORT=high` */
const ENV_EFFORT_KEY = /^([A-Z][A-Z0-9_]*REASONING_EFFORT)=(.*)$/gm;

function matches(file: string, pattern: RegExp): [string, string][] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(pattern)].map(([, name, value]) => [name, value]);
}

const SUPPORTED = new Set<string>(MANTLE_REASONING_EFFORTS);

describe("reasoning effort contract", () => {
  it("accepts only what Mantle's own error message lists", () => {
    // Pinned as a whole rather than checked loosely, so that widening the set
    // is a deliberate edit made against a real response from the endpoint.
    expect([...MANTLE_REASONING_EFFORTS]).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(SUPPORTED.has("minimal")).toBe(false);
  });

  /**
   * The one that would have caught the outage. `terraform apply` writes these
   * into the task definition, where they beat every default in `src`.
   */
  it("ships Terraform defaults the model accepts", () => {
    const found = matches(VARIABLES_TF, TF_EFFORT_VARIABLE);
    // Guards the regex rather than the values: a rename that stopped matching
    // would otherwise pass this test by finding nothing at all. Three features
    // send an effort today, the review, the scope assessment and the social
    // summary, so a count below that means the scan broke.
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const [name, value] of found) {
      expect(`${name}=${value}`).toBe(
        `${name}=${SUPPORTED.has(value) ? value : `<one of ${[...SUPPORTED].join(", ")}>`}`
      );
    }
  });

  it("documents defaults the model accepts", () => {
    const found = matches(ENV_EXAMPLE, ENV_EFFORT_KEY);
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const [name, value] of found) {
      expect(`${name}=${value}`).toBe(
        `${name}=${SUPPORTED.has(value) ? value : `<one of ${[...SUPPORTED].join(", ")}>`}`
      );
    }
  });

  it("falls back to values the model accepts", () => {
    const empty = {} as NodeJS.ProcessEnv;
    expect(SUPPORTED.has(buildSocialSummaryConfig(empty).reasoningEffort)).toBe(
      true
    );
    expect(SUPPORTED.has(buildScopeConfig(empty).reasoningEffort)).toBe(true);
    expect(SUPPORTED.has(buildReviewConfig(empty).reasoningEffort)).toBe(true);
  });
});
