/**
 * The message a thrown value carries: an Error's message or a bare string,
 * else `fallback`. A `catch` binding is `unknown`, not an `Error`, and an
 * empty message must not win either: the callers render it behind
 * `{error && ...}`, so an empty string would fail with nothing on screen.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err) {
    return err;
  }
  return fallback;
}
