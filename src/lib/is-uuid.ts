/**
 * Route params arrive as arbitrary strings. The server functions validate ids
 * with Zod's `.uuid()`, which throws on a malformed value and surfaces as a
 * 500, but a URL that cannot name a record is a 404, not a server fault. Route
 * loaders call this first so the status code reflects the actual situation.
 *
 * Accepts the RFC 4122 forms Postgres `uuid` columns round-trip, case
 * insensitively, and rejects everything else including the nil-with-wrong-shape
 * strings that a truncated copy-paste produces.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value);
}
