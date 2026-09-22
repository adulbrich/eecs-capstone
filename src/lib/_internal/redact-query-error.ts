/**
 * Turns a thrown value into something safe to write to a log group.
 *
 * Drizzle's `DrizzleQueryError` carries the bound parameters of the failed
 * query, and the parameters of a Better Auth session lookup are the session
 * token: a live credential that signs its bearer in until it expires. A burst that
 * exhausts the connection pool makes the session lookup time out on acquire,
 * which is how a query error reaches a logger at all. Addresses travel the same
 * path.
 *
 * The trap, and the reason this returns a string rather than a tidied error:
 * `DrizzleQueryError`'s constructor interpolates the parameters into
 * `error.message` as well as storing them on `error.params`. So the habit
 * `db-pool.ts` established for pool errors, logging `error.message` and
 * nothing else, is not enough here and would have looked like a fix. All three
 * of `error.message`, `String(error)` and `util.inspect(error)` carry the
 * secret, which is measured in `redact-query-error.test.ts` rather than
 * asserted. A string with no error object behind it is the only shape a
 * console method cannot walk back into.
 *
 * What survives: the failing query's SQL, which is schema rather than user
 * data and is in this repository already, and the cause chain's messages,
 * which is where "Connection terminated due to connection timeout" lives and
 * is the whole diagnostic value of the line.
 */

/** How much of the failing SQL to keep. Enough to identify the query. */
const QUERY_LIMIT = 200;

/** How far down a `cause` chain to walk before giving up on a cycle. */
const MAX_CAUSE_DEPTH = 5;

interface QueryErrorShape {
  params: unknown;
  query: string;
}

/**
 * Structural rather than `instanceof DrizzleQueryError`. A bundle can hold two
 * copies of drizzle, a driver can wrap the error, and either defeats the
 * prototype check while leaving the hazard in place. The shape is the hazard.
 */
function isQueryError(value: unknown): value is QueryErrorShape {
  return (
    value instanceof Error &&
    typeof (value as Partial<QueryErrorShape>).query === "string" &&
    "params" in value
  );
}

/**
 * The two shapes a parameter tail arrives in.
 *
 * The first is `DrizzleQueryError`'s own message template. The second is what
 * `JSON.stringify` of that error produces, because it sets `query` and
 * `params` as own enumerable properties, so a serialized copy carries the
 * parameters with no newline in front of them. Nothing here serializes a
 * caught value today, and `handleAuthRequest` answers with an empty body, so
 * the second marker covers a shape this codebase does not currently produce.
 * It is here because a structured logger is the obvious next change to a
 * service that writes to a log group, and that change would otherwise reopen
 * this silently.
 */
const PARAM_MARKERS = ["\nparams:", '"params":'];

/**
 * Strips the parameter tail off a message that already carries one.
 *
 * `DrizzleQueryError` builds its message as ``Failed query: ${query}\nparams:
 * ${params}``, and that string travels on its own: Better Auth logs
 * `error.message` rather than the error in one branch, and any `catch` that
 * reaches for `.message` produces the same thing. So a string arriving here is
 * not automatically safe just because it is a string, which is the mistake the
 * first version of this file made.
 */
function scrubQueryText(text: string): string {
  // Keyed on the separator alone rather than also requiring the string to
  // start with "Failed query:". Anything that wraps the message in a prefix,
  // `new Error(`Adapter: ${error.message}`)`, would otherwise pass through
  // whole. Nothing in this codebase or in Better Auth does that today, but the
  // cost of covering it is one dropped condition, and the failure mode of the
  // looser test is a truncated log line rather than a leaked one.
  const marker = PARAM_MARKERS.reduce((earliest, candidate) => {
    const at = text.indexOf(candidate);
    return at !== -1 && at < earliest ? at : earliest;
  }, Number.POSITIVE_INFINITY);
  if (marker === Number.POSITIVE_INFINITY) {
    return text;
  }
  return `${text.slice(0, marker)} [params redacted]`;
}

function truncate(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length > QUERY_LIMIT
    ? `${collapsed.slice(0, QUERY_LIMIT)}...`
    : collapsed;
}

/**
 * One error's own description, with the parameters taken out. Not recursive:
 * `redactQueryError` walks the chain, so that a wrapped query error deeper
 * down is redacted too rather than only the outermost one.
 */
function describe(value: unknown): string {
  if (isQueryError(value)) {
    // Rebuilt rather than edited. `error.message` already has the parameters
    // interpolated into it, so anything derived from it starts out unsafe.
    return `query failed [params redacted]: ${truncate(value.query)}`;
  }
  if (value instanceof Error) {
    return `${value.name}: ${scrubQueryText(value.message)}`;
  }
  if (typeof value === "string") {
    return scrubQueryText(value);
  }
  return Object.prototype.toString.call(value);
}

/**
 * A single log-safe line for a thrown value, including the messages of
 * whatever it was caused by. Pass the result to the logger, never the error.
 */
export function redactQueryError(value: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current === undefined || current === null || seen.has(current)) {
      break;
    }
    seen.add(current);
    parts.push(describe(current));
    current =
      current instanceof Error
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return parts.join(" <- ");
}

/**
 * The `log` half of Better Auth's `logger` option, which is one of the two
 * ways a query error reaches a console method from the auth stack.
 *
 * The message is redacted as well as the arguments, because Better Auth's own
 * endpoints call `ctx.logger.error(...)` directly and are free to put anything
 * in that slot, including a message they took off an error. The message of a
 * query error is the one with the parameters interpolated into it, so the
 * message slot is untrusted here on the same footing as the arguments.
 *
 * Better Auth's router has a second branch that would put a whole query
 * message there, when the text contains "column", "relation", "table" or
 * "does not exist" (`better-auth/dist/api/index.mjs`), and it matches inside a
 * word, so an address like `alice.consTABLEe@` reaches it. On this
 * configuration `onAPIError: { throw: true }` makes that branch unreachable.
 * It is recorded because it is what the substring test costs if the throw is
 * ever removed, not as the reason this redaction exists.
 *
 * Do not add `level` to the `logger` option beside this. Better Auth reads
 * `options.logger.level` to decide whether to also hand the message to its own
 * global logger, which is not this one, and setting it routes a copy around
 * the redaction. Leaving it unset keeps every line going through here.
 */
export function redactingAuthLogger(
  write: (message: string) => void = console.error
) {
  return (level: string, message: string, ...args: unknown[]): void => {
    const extra = args.map((arg) => redactQueryError(arg));
    const safeMessage = redactQueryError(message);
    write(
      `[Better Auth] ${level}: ${safeMessage}${extra.length > 0 ? ` ${extra.join(" ")}` : ""}`
    );
  };
}
