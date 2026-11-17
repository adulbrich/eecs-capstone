import { inspect } from "node:util";
import { fc, test } from "@fast-check/vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  redactingAuthLogger,
  redactQueryError,
} from "../_internal/redact-query-error";

/** Stands in for a session token, which is what the real leak carried. */
const SECRET = "qwWFNB6KRoIbxasS3zDrfREsB7dGx4Hw";

const SESSION_SQL =
  'select "id", "expires_at", "token", "user_id" from "session" where "session"."token" = $1';

/** The shape Better Auth hands its logger when a session lookup fails. */
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

  it("scrubs a query message that arrives as a bare string", () => {
    // `error.message` travels on its own all over this codebase, through
    // `errorMessage()` among others. A string is not safe just for being one.
    const line = redactQueryError(sessionLookupFailure().message);
    expect(line).not.toContain(SECRET);
  });

  it("scrubs a query message wrapped in a plain Error", () => {
    const rethrown = new Error(sessionLookupFailure().message);
    expect(redactQueryError(rethrown)).not.toContain(SECRET);
  });

  it("scrubs a query message that something else prefixed", () => {
    // A wrapper that interpolates rather than using `cause` produces a message
    // that no longer starts with "Failed query:". Nothing does this today.
    const prefixed = new Error(
      `Adapter failed: ${sessionLookupFailure().message}`
    );
    expect(redactQueryError(prefixed)).not.toContain(SECRET);
  });

  it("scrubs the parameters out of a serialized query error", () => {
    // `DrizzleQueryError` sets `query` and `params` as own enumerable
    // properties, so `JSON.stringify` writes the token out in full with no
    // newline in front of it. Nothing serializes a caught value today; this
    // pins the shape so a structured logger cannot reopen the leak quietly.
    const serialized = JSON.stringify(sessionLookupFailure());
    expect(serialized).toContain(SECRET);
    expect(redactQueryError(serialized)).not.toContain(SECRET);
  });

  describe("a params tail after whitespace other than one newline (#608)", () => {
    // DrizzleQueryError always writes exactly "\nparams:", so none of these
    // has a producer today. A wrapper that reflows the message would make one,
    // and the looser match costs a truncated line where the tighter one would
    // cost a leaked token.
    const shapes = [
      ["a space", `Failed query: select 1 params: ${SECRET}`],
      ["an indent", `Failed query: select 1\n  params: ${SECRET}`],
      ["a tab", `Failed query: select 1\tparams: ${SECRET}`],
      ["U+2028", `Failed query: select 1 params: ${SECRET}`],
      ["U+2029", `Failed query: select 1 params: ${SECRET}`],
      ["a carriage return", `Failed query: select 1\r\nparams: ${SECRET}`],
      ["an escaped newline", `Failed query: select 1\\nparams: ${SECRET}`],
    ] as const;

    for (const [name, text] of shapes) {
      it(`redacts it after ${name}, as a string`, () => {
        const line = redactQueryError(text);
        expect(line).not.toContain(SECRET);
        expect(line).toBe("Failed query: select 1 [params redacted]");
      });

      it(`redacts it after ${name}, as an Error message`, () => {
        const line = redactQueryError(new Error(text));
        expect(line).not.toContain(SECRET);
        expect(line).toContain("[params redacted]");
      });
    }

    it("cuts at the earliest marker when both shapes appear", () => {
      const text = `a params: ${SECRET} "params":["other"]`;
      expect(redactQueryError(text)).toBe("a [params redacted]");
    });
  });

  it("leaves the word params alone mid-sentence without a colon", () => {
    const text = "the request had no params so nothing was bound";
    expect(redactQueryError(text)).toBe(text);
    expect(redactQueryError(new Error(text))).toBe(`Error: ${text}`);
  });

  it("leaves an ordinary string alone", () => {
    expect(redactQueryError("params: not a query error")).toBe(
      "params: not a query error"
    );
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

/** An address the app could send to, which is one `z.email()` accepts. */
const zodAddress = fc
  .emailAddress()
  .filter((address) => z.email().safeParse(address).success);

/** Anything still shaped like such an address after redaction. */
const ANY_ADDRESS = /[A-Za-z0-9_'+.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/u;

describe("redactQueryError, on an address outside a query", () => {
  /** What a sandboxed SES account throws for an unverified recipient. */
  const SES_REJECTION =
    "Email address is not verified. The following identities failed the check in region US-WEST-2: alice.o'brien+cap@oregonstate.edu";

  function sesRejection(): Error {
    const error = new Error(SES_REJECTION);
    error.name = "MessageRejected";
    return error;
  }

  it("keeps the recipient SES names out of the line, and keeps the reason", () => {
    expect(redactQueryError(sesRejection())).toBe(
      "MessageRejected: Email address is not verified. The following identities failed the check in region US-WEST-2: [address redacted]"
    );
  });

  it("redacts an address further down the cause chain", () => {
    const wrapped = new Error("send failed", { cause: sesRejection() });
    expect(redactQueryError(wrapped)).not.toContain("@");
  });

  it("redacts every address in a list, and in a bare string", () => {
    expect(
      redactQueryError("rejected: a@x.edu, B.Two@sub.example.co.uk; c-3@y.io.")
    ).toBe(
      "rejected: [address redacted], [address redacted]; [address redacted]."
    );
  });

  it.each([
    ["+", "a@x.edu+b@y.edu"],
    ["_", "a@x.edu_b@y.edu"],
    ["/", "a@x.edu/b@y.edu"],
    [".", "a@x.edu.b@y.edu"],
  ])("redacts both of two addresses joined by %j", (_joiner, text) => {
    // A regex anchored with a lookbehind could not start a match where the
    // previous one ended, so the second address survived whole.
    const line = redactQueryError(text);
    expect(line).not.toContain("@");
    expect(line).not.toContain("y.edu");
  });

  it.each([
    ["a run with no @", "a".repeat(100_000)],
    ["a dotted run with no @", "a.".repeat(50_000)],
    ["a domain with no dot", `x@${"a".repeat(100_000)}`],
    ["an @ after every character", "a@".repeat(50_000)],
    ["a domain that never ends in a letter", `x@${"1.".repeat(50_000)}`],
    ["a chain of addresses", "a@x.co+".repeat(14_000)],
  ])("stays linear on %s, which a stranger can send", (_shape, input) => {
    // An unanchored regex rescanned a run from every position: 40,000
    // characters took a second, and 100,000 about six. The first call pays
    // for compiling the patterns, which is not the cost under test.
    redactQueryError(input);
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      redactQueryError(input);
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(100);
  });

  it.each([
    "installed @aws-sdk/client-sesv2@3.700.0",
    "installed drizzle-orm@0.44.2",
    "in .pnpm/@aws-sdk+client-sesv2@3.600.0/node_modules",
  ])("leaves a versioned package alone: %j", (text) => {
    expect(redactQueryError(text)).toBe(text);
  });

  it("keeps a URL's host and path when its query names an address", () => {
    // A stranger chooses a logged callbackURL, so a match that ran back
    // through the path would let them blank out where it pointed.
    expect(
      redactQueryError("Invalid callbackURL: https://evil.example/x?r=a@b.co")
    ).toBe("Invalid callbackURL: https://evil.example/x?r=[address redacted]");
  });

  it("leaves a scoped package path alone", () => {
    const text =
      "Cannot find module '/app/node_modules/@aws-sdk/client-sesv2/dist/index.js'";
    expect(redactQueryError(new Error(text))).toBe(`Error: ${text}`);
  });

  // Every address the sign-in form accepts, between ordinary words, comes
  // out as the marker and nothing else: no prefix of an odd local part, no
  // tail of a long domain.
  test.prop([
    zodAddress,
    fc.stringMatching(/^[A-Za-z ]{0,20}$/u),
    fc.stringMatching(/^[A-Za-z ]{0,20}$/u),
  ])(
    "redacts every address z.email() accepts, whole",
    (address, before, after) => {
      expect(redactQueryError(new Error(`${before} ${address} ${after}`))).toBe(
        `Error: ${before} [address redacted] ${after}`
      );
    }
  );

  // A match has to be able to start where the previous one ended, whatever
  // joins the two: a lookbehind-anchored regex left the second of
  // `a@a.aa_a@a.aa` whole.
  test.prop([
    zodAddress,
    zodAddress,
    fc.constantFrom(..."_'+.-%!#$&*/=?^`{|}~,; <>\""),
  ])(
    "leaves no address in two joined by one character",
    (first, second, joiner) => {
      expect(redactQueryError(`${first}${joiner}${second}`)).not.toMatch(
        ANY_ADDRESS
      );
    }
  );

  test.prop([
    fc
      .string({ unit: "binary" })
      .filter((text) => !(text.includes("@") || text.includes("params"))),
  ])("passes text with no @ through unchanged", (text) => {
    expect(redactQueryError(text)).toBe(text);
  });

  test.prop([
    fc
      .string({ unit: "binary", maxLength: 40 })
      .filter((text) => !text.includes("params")),
  ])("reads an Error's message the way it reads a string", (text) => {
    expect(redactQueryError(new Error(text))).toBe(
      `Error: ${redactQueryError(text)}`
    );
  });

  it("does not throw on an Error whose message is not a string", () => {
    const odd = new Error("x");
    (odd as { message: unknown }).message = 42;
    expect(redactQueryError(odd)).toBe("Error: 42");
  });
});

describe("redactingAuthLogger", () => {
  it("writes one line, so a newline in logged text cannot start an event", () => {
    // Better Auth logs a rejected callbackURL word for word, and awslogs makes
    // each line of a write its own CloudWatch event.
    const lines: string[] = [];
    const log = redactingAuthLogger((line) => lines.push(line));

    log(
      "error",
      "Invalid callbackURL: x\r\nProject refresh for p1: embedding failed",
      new Error("first\nsecond")
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/u);
    expect(lines[0]).toContain("x Project refresh for p1");
  });

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

  it("redacts the message slot, not only the arguments", () => {
    // Better Auth logs `e.message` as the message, with no error attached,
    // whenever the message contains "column", "relation", "table" or "does not
    // exist" (better-auth/dist/api/index.mjs). A query error's message is the
    // one carrying the parameters, and the substring test matches inside a
    // word, so an address like alice.consTABLEe@oregonstate.edu reaches it.
    const lines: string[] = [];
    const log = redactingAuthLogger((line) => lines.push(line));

    log("error", sessionLookupFailure().message);

    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).toContain("params redacted");
  });

  it("still says what level it was", () => {
    const lines: string[] = [];
    redactingAuthLogger((line) => lines.push(line))("warn", "something");
    expect(lines[0]).toContain("warn");
    expect(lines[0]).toContain("something");
  });
});
