/**
 * TanStack Start's server entry, replacing the default one to add a log line
 * for a failed server render (#602) and a 403 for the access-denied page
 * (#606); `renderFailureLines` says why this is the one place that sees every
 * route's failure. Nitro loads this on the first request rather than at boot
 * (docs/QUIRKS.md, TanStack Start), so a check that must stop the process
 * belongs in a Nitro plugin, not here.
 */

import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  refusedByRole,
  renderFailureLines,
} from "#/lib/_internal/render-failure";

// Imported for its side effect, the pool's warm-up, so that it runs on a new
// task's first request, the load balancer's health check (ADR-0052).
import "#/db";

type Rendered = Awaited<ReturnType<typeof defaultStreamHandler>>;

/**
 * The same render with another status. The body stream is handed over
 * rather than copied, and a streamed result keeps its own `dispose`, which
 * cancels that same stream if the client goes away.
 */
function withStatus(rendered: Rendered, status: number): Rendered {
  const restatus = (response: Response) =>
    new Response(response.body, { status, headers: response.headers });
  return rendered instanceof Response
    ? restatus(rendered)
    : { ...rendered, response: restatus(rendered.response) };
}

const handler = defineHandlerCallback(async (ctx) => {
  const { matches } = ctx.router.state;
  for (const line of renderFailureLines(matches)) {
    console.error(line);
  }
  const rendered = await defaultStreamHandler(ctx);
  return refusedByRole(matches) ? withStatus(rendered, 403) : rendered;
});

export default createServerEntry({ fetch: createStartHandler(handler) });
