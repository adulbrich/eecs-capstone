import { redactQueryError } from "./redact-query-error";

/** The part of a router match this reads. */
interface RenderedMatch {
  error?: unknown;
  routeId: string;
  status: string;
}

/**
 * The log lines for a server render whose loader or `beforeLoad` threw, one
 * per failed match, for `src/server.ts` to write (#602).
 *
 * Without this a failed SSR render wrote nothing at all. router-core's
 * `load-server.js` catches the loader's error and parks it on the match, and
 * `Match.js` renders the error component straight from it on the server, so
 * neither `onCatch` nor `defaultOnCatch` runs there. The one place every
 * route's failure passes through with the error still attached is the Start
 * handler callback, after `router.load()` and before the stream.
 *
 * Only `status === "error"`, which router-core's `applyFailure` sets on the
 * one match that failed and answers 500 for. A `notFound()` marks its
 * boundary `notFound`, or leaves the root `success`, and keeps the thrown
 * value on `error` in both cases, so the status is the test and not whether
 * `error` is set. A `redirect()` returns before the callback runs.
 *
 * The route id rather than the URL: the URL carries the search box's `q`,
 * which is user text (ADR-0042). The cause goes through `redactQueryError`
 * for the same reason, so a failed search logs its SQL and the pool's
 * "connection timeout" but not the term it was bound to.
 */
export function renderFailureLines(
  matches: readonly RenderedMatch[]
): string[] {
  return matches
    .filter((match) => match.status === "error")
    .map(
      (match) =>
        `Server render failed on ${match.routeId} (500): ${redactQueryError(match.error)}`
    );
}
