/**
 * A placeholder origin to resolve against. The check only asks whether the
 * value stays on whatever origin it is resolved on, so any origin answers it,
 * and this one keeps the helper free of `window` for the server render.
 */
const BASE = "http://same-origin.invalid";

/**
 * The value as a path on this site, or `undefined` when it is anything else,
 * for a param that names where to go after an action, like `?redirect=` on
 * `/sign-in` (#702).
 *
 * Kept only when it starts with a single `/`, not `//` or `/\`, and still
 * resolves to the same origin once the URL parser has had it: the parser
 * drops a tab or newline before it reads an authority, so `/\t/evil.example`
 * passes the prefix checks and is still `//evil.example`. Returns what the
 * parser resolved rather than the input, and checks that too, so the value
 * that was checked is the value that is used.
 *
 * TanStack Router and Better Auth each refuse an off-site target today (see
 * QUIRKS, "Route search params via `validateSearch`"). This is the check the
 * app owns, so neither library's behaviour is load-bearing.
 */
export function sameOriginPath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return;
  }
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return;
  }
  if (url.origin !== BASE) {
    return;
  }
  // Checked again on the way out, because resolving dot segments can make a
  // `//` the input did not start with: `/.//evil.example` and
  // `/a/..//evil.example` both come back as `//evil.example`, which a caller
  // would read as another host. The parser has already turned every
  // backslash in the path into `/`, so this one prefix covers `/\` too.
  const resolved = `${url.pathname}${url.search}${url.hash}`;
  return resolved.startsWith("//") ? undefined : resolved;
}
