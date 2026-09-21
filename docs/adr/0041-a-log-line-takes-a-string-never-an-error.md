# A log line takes a string, never an error object

Every `catch` in this codebase logs `redactQueryError(error)` from
`src/lib/_internal/redact-query-error.ts` and never the error itself, because
an error object carries more than its message and the extra is sometimes a
credential. Drizzle's `DrizzleQueryError` is the case that forced the rule: it
stores the failed query's bound parameters on `.params`, and the parameter of a
Better Auth session lookup is the session token, which signs in whoever holds
it. Password reset tokens, verification tokens and addresses reach a logger by
the same route. The reason this is a decision rather than a note is that the
obvious defence does not work and looks like it does: `DrizzleQueryError`'s
constructor interpolates the parameters into `error.message` as well, so
`error.message`, `String(error)` and `util.inspect(error)` all carry them, and
the habit [ADR-0034](./0034-the-pool-is-sized-against-the-instance.md)
established for pool errors, logging `error.message` and nothing else, would
have shipped as a fix while leaking. A helper returning a string is what makes
the rule enforceable, because a string is the one shape no console method can
walk back into an object, and the caller cannot accidentally pass the original
alongside it. Two further seams needed closing for the auth path specifically,
and they only work as a pair: `onAPIError: { throw: true }` in `src/lib/auth.ts`
stops Better Auth's `onError` returning undefined and letting `better-call`'s
router reach its own `console.error("# SERVER_ERROR: ", error)` with the raw
object, and `handleAuthRequest` in `src/lib/_internal/auth-request.ts` catches
what that throw produces, logs it redacted and returns the same 500 the router
would have. The alternative considered and rejected was turning Better Auth's
logger off, which removes the leak by removing the signal and would have left
an auth failure with nothing written at all. Decided 2026-09-21.

## Consequences

`src/lib/__tests__/redact-query-error.test.ts` pins the hazard as well as the
fix: it asserts against a real `DrizzleQueryError` that the message carries the
parameters, so if a later drizzle stops doing that the test says so rather than
quietly making the redaction pointless. The message is scrubbed as well as the
error, because Better Auth logs `e.message` in the message slot when the text
contains "column", "relation", "table" or "does not exist", and that substring
test matches inside a word, so an address such as `alice.consTABLEe@` reaches
it. Do not add `level` to the `logger` option in `src/lib/auth.ts`: Better Auth
reads it to decide whether to hand the message to its own global logger as
well, which routes a copy around the redaction. The cost of the rule is
diagnostic: a redacted line keeps the SQL and the cause chain but not the
values, so a bug that depends on which row was being read is harder to chase
from logs alone, and the answer there is to reproduce rather than to widen the
log. Anything that logs an error object in future should be caught in review;
there is no scan test for it yet, and writing one is the obvious follow-up
because the rule is exactly the kind a scan can check.
