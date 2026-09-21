/**
 * Turns a thrown value into something safe to write to a log group.
 *
 * Drizzle's `DrizzleQueryError` carries the bound parameters of the failed
 * query, and the parameters of a Better Auth session lookup are the session
 * token: a live credential that signs its bearer in until it expires. The
 * 2026-09-21 load test found exactly that in `/ecs/eecs-capstone`, twice, when
 * a burst exhausted the connection pool and the session lookup timed out on
 * acquire. Password reset and email verification tokens travel the same path,
 * and so do addresses.
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
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
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
 * The `log` half of Better Auth's `logger` option, which is where the leak was
 * actually observed: Better Auth catches the query error and hands the object
 * to its own logger, whose default writes it through a console method.
 * Redacting every argument here covers that without turning its logging off,
 * which would have traded one problem for a blind spot.
 */
export function redactingAuthLogger(
  write: (message: string) => void = console.error
) {
  return (level: string, message: string, ...args: unknown[]): void => {
    const extra = args.map((arg) => redactQueryError(arg));
    write(
      `[Better Auth] ${level}: ${message}${extra.length > 0 ? ` ${extra.join(" ")}` : ""}`
    );
  };
}
