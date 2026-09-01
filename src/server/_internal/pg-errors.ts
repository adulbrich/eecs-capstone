/**
 * Drizzle wraps the driver error, so the message on the thrown object is
 * "Failed query: insert into ..." and the SQLSTATE sits one level down in
 * `cause`. Matching the message is the wrong idea twice over: a regex loose
 * enough to catch the real error is also loose enough to pass on an unrelated
 * one. `23505` is unique_violation, and naming the constraint means a
 * different index cannot satisfy the check.
 */
export interface PgError {
  cause?: unknown;
  code?: string;
  constraint?: string;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Walks the cause chain and returns the driver error if it is a unique
 * violation on exactly this constraint, otherwise undefined.
 */
export function findUniqueViolation(
  error: unknown,
  constraint: string
): PgError | undefined {
  for (
    let current = error as PgError | null | undefined;
    current && typeof current === "object";
    current = current.cause as PgError | null | undefined
  ) {
    if (
      current.code === UNIQUE_VIOLATION &&
      current.constraint === constraint
    ) {
      return current;
    }
  }
  return;
}
