import { redactQueryError } from "#/lib/_internal/redact-query-error";

/**
 * The last catch before an auth request leaves the app, and half of a pair.
 *
 * The other half is `onAPIError: { throw: true }` in `src/lib/auth.ts`. Better
 * Auth's own `onError` returns undefined on every branch it takes, so without
 * the throw `better-call`'s router carries on to
 * `console.error("# SERVER_ERROR: ", error)` and writes the raw error object
 * (`better-call/dist/router.mjs`). A Drizzle query error carries the failed
 * query's bound parameters, and for a session lookup that parameter is the
 * session token, so that one line would put a live credential in the log group. The
 * throw takes the error out of the router before it, and this is then the only
 * thing left that can answer the request.
 *
 * Neither half works alone: the throw without this is an uncaught rejection in
 * a route handler, and this without the throw never runs, because the router
 * swallows the error and returns its own 500 first.
 *
 * The status matches what the router would have returned, so nothing a client
 * sees changes. Redirects never reach here (Better Auth returns early on a
 * `FOUND`), and an APIError is turned into its response by the router's own
 * catch, so this sees genuine failures only.
 */
export async function handleAuthRequest(
  request: Request,
  handler: (request: Request) => Promise<Response>,
  log: (message: string) => void = console.error
): Promise<Response> {
  try {
    return await handler(request);
  } catch (error) {
    log(`Auth request failed: ${redactQueryError(error)}`);
    return new Response(null, {
      status: 500,
      statusText: "Internal Server Error",
    });
  }
}
