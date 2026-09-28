import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProjectReview } from "../_internal/project-review-core";
import { runScopeAssessment } from "../_internal/scope-assessment-core";
import { runSocialSummary } from "../_internal/social-summary-core";

/**
 * What a failed Mantle call leaves in `run.error`, which each wrapper rethrows
 * to the browser (#619). Driven through the real `mantleResponses` with a
 * stubbed `fetch`, so the thrown text is the one production builds rather
 * than a message this file made up.
 */
/**
 * A signature-mismatch body that echoes the request's own Authorization value
 * back, as AWS does in a canonical request. The token line is the issue's
 * `SECRET`, which is not a value this request signed: static keys sign no
 * token, so `redactSignedValues`'s own tests carry the token cases.
 */
function secretBody(authorization: string) {
  return [
    "The request signature we calculated does not match.",
    `authorization:${authorization}`,
    "x-amz-security-token: SECRET",
    `${"y".repeat(600)}TAIL`,
  ].join("\n");
}

const RUNNERS = [
  {
    feature: "the review",
    fixed: "Couldn't generate suggestions, please try again.",
    run: () => runProjectReview({ title: "Rover" }),
  },
  {
    feature: "the scope assessment",
    fixed: "Couldn't assess the scope, please try again.",
    run: () => runScopeAssessment("Rover"),
  },
  {
    feature: "the social summary",
    fixed: "Couldn't write the summary, please try again.",
    run: () => runSocialSummary("Rover"),
  },
];

beforeEach(() => {
  // Static keys, so the signer never walks the credential chain.
  vi.stubEnv("BEDROCK_ACCESS_KEY", "AKIDEXAMPLE");
  vi.stubEnv("BEDROCK_SECRET_KEY", "secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(RUNNERS)("a failed Mantle call in $feature", ({ fixed, run }) => {
  it("reaches the caller as the fixed message and the log as one string", async () => {
    let authorization = "";
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      authorization = (init.headers as Record<string, string>).authorization;
      return Promise.resolve(
        new Response(secretBody(authorization), { status: 403 })
      );
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      // The line is the assertion, not output for the test run.
    });

    const result = await run();

    expect(result.error).toBe(fixed);
    expect(logged).toHaveBeenCalledOnce();
    const line = logged.mock.calls[0]?.slice(1);
    expect(line).toHaveLength(1);
    expect(typeof line?.[0]).toBe("string");
    expect(line?.[0]).toContain("403");
    expect(line?.[0]).toContain("signature we calculated does not match");
    expect(line?.[0]).toContain("x-amz-security-token: SECRET");
    // The request's own signed value is redacted, and the body is one line
    // cut at 500 characters, so what follows the cut never reaches it.
    expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/);
    expect(line?.[0]).toContain("authorization:[redacted]");
    expect(line?.[0]).not.toContain(authorization);
    expect(line?.[0]).not.toMatch(/AKIDEXAMPLE|\n/);
    expect(line?.[0]).not.toContain("TAIL");
    // And none of it reaches the caller.
    expect(result.error).not.toMatch(/SECRET|403/);
  });

  it("keeps a failed fetch's cause in the log and out of the message", async () => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
        code: "ECONNREFUSED",
      }),
    });
    vi.stubGlobal("fetch", () => Promise.reject(refused));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      // As above.
    });

    const result = await run();

    expect(result.error).toBe(fixed);
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]?.[1]).toContain(
      "ECONNREFUSED: connect ECONNREFUSED 10.0.0.1:443"
    );
  });
});
