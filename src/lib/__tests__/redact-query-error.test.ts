import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import {
  redactingAuthLogger,
  redactQueryError,
} from "../_internal/redact-query-error";

/** Stands in for a session token, which is what the real leak carried. */
const SECRET = "qwWFNB6KRoIbxasS3zDrfREsB7dGx4Hw";

const SESSION_SQL =
  'select "id", "expires_at", "token", "user_id" from "session" where "session"."token" = $1';

/** The shape Better Auth handed its logger on 2026-09-21. */
function sessionLookupFailure(): DrizzleQueryError {
  return new DrizzleQueryError(
    SESSION_SQL,
    [SECRET],
    new Error("Connection terminated due to connection timeout")
  );
}

describe("the hazard this exists for", () => {
  // Measured, not assumed. If a future drizzle stops interpolating the
  // parameters into the message, these go green on their own and the redaction
  // below is merely belt and braces rather than load bearing.
  it("puts the bound parameters in the message, not only on the error", () => {
    const error = sessionLookupFailure();
    expect(error.message).toContain(SECRET);
    expect(String(error)).toContain(SECRET);
    expect(inspect(error)).toContain(SECRET);
  });

  it("is therefore not made safe by logging only the message", () => {
    // `db-pool.ts` logs `error.message` and nothing else, which is right for a
    // pool error and wrong here. Pinning it so nobody copies that habit over.
    expect(sessionLookupFailure().message).toContain(SECRET);
  });
});

describe("redactQueryError", () => {
  it("keeps the session token out of the line", () => {
    const line = redactQueryError(sessionLookupFailure());
    expect(line).not.toContain(SECRET);
  });

  it("keeps the cause, which is the diagnostic value", () => {
    const line = redactQueryError(sessionLookupFailure());
    expect(line).toContain("Connection terminated due to connection timeout");
  });

  it("keeps the query, which is schema rather than user data", () => {
    const line = redactQueryError(sessionLookupFailure());
    expect(line).toContain('from "session"');
    expect(line).toContain("params redacted");
  });

  it("redacts a query error nested below another error", () => {
    // Better Auth wraps. A walk that only checked the outermost value would
    // pass every assertion above and still leak.
    const wrapped = new Error("INTERNAL_SERVER_ERROR", {
      cause: sessionLookupFailure(),
    });
    expect(redactQueryError(wrapped)).not.toContain(SECRET);
  });

  it("does not hang on a cause that points at itself", () => {
    const looping = new Error("outer") as Error & { cause?: unknown };
    looping.cause = looping;
    expect(redactQueryError(looping)).toBe("Error: outer");
  });

  it("handles what a throw can actually be", () => {
    expect(redactQueryError("plain string")).toBe("plain string");
    expect(redactQueryError(undefined)).toBe("");
    expect(redactQueryError(null)).toBe("");
    expect(redactQueryError({ nope: true })).toBe("[object Object]");
  });

  it("truncates a long query rather than filling the log group", () => {
    const long = new DrizzleQueryError(
      `select ${"x".repeat(5000)}`,
      [],
      undefined
    );
    expect(redactQueryError(long).length).toBeLessThan(400);
  });
});

describe("redactingAuthLogger", () => {
  it("redacts the error Better Auth passes alongside its message", () => {
    const lines: string[] = [];
    const log = redactingAuthLogger((line) => lines.push(line));

    log("error", "INTERNAL_SERVER_ERROR", sessionLookupFailure());

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).toContain("INTERNAL_SERVER_ERROR");
    expect(lines[0]).toContain(
      "Connection terminated due to connection timeout"
    );
  });

  it("still says what level it was", () => {
    const lines: string[] = [];
    redactingAuthLogger((line) => lines.push(line))("warn", "something");
    expect(lines[0]).toContain("warn");
    expect(lines[0]).toContain("something");
  });
});
