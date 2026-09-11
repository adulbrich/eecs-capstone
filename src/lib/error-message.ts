/**
 * The message a thrown value carries: an Error's message or a bare string,
 * else `fallback`. A `catch` binding is `unknown`, not an `Error`.
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
