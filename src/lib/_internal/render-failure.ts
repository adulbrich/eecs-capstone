import { isAccessDenied } from "#/lib/access-denied";
import { redactQueryError } from "./redact-query-error";

const WHITESPACE_RUN = /\s+/g;

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
 * Not a role guard's refusal either (#606). router-core marks that match
 * `error` too, because the guard throws, but it is a page working as meant,
 * and `refusedByRole` is what turns its 500 into a 403.
 *
 * The route id rather than the URL: the URL carries the search box's `q`,
 * which is user text (ADR-0042). The cause goes through `redactQueryError`
 * for the same reason, so a failed search logs its SQL and the pool's
 * "connection timeout" but not the term it was bound to.
 *
 * Whitespace is collapsed because the awslogs driver makes each line of
 * stdout its own CloudWatch event, and a failed `validateSearch` throws
 * `SearchParamError` with pretty-printed JSON for a message: one failure
 * would otherwise arrive as a dozen events, most of them a lone bracket.
 */
export function renderFailureLines(
  matches: readonly RenderedMatch[]
): string[] {
  return matches
    .filter((match) => match.status === "error" && !isAccessDenied(match.error))
    .map((match) =>
      `Server render failed on ${match.routeId} (500): ${redactQueryError(match.error)}`.replace(
        WHITESPACE_RUN,
        " "
      )
    );
}

/**
 * Whether this render is the access-denied page (#606), for `src/server.ts`
 * to answer 403 rather than the 500 router-core picks for any thrown value.
 * router-core has no status of its own for it: a server render answers 200,
 * 404 or 500, and `setResponseStatus` does not reach a rendered page.
 */
export function refusedByRole(matches: readonly RenderedMatch[]): boolean {
  return matches.some(
    (match) => match.status === "error" && isAccessDenied(match.error)
  );
}
