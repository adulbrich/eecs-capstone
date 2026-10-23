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
  setResponseStatus,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  refusedByRole,
  renderFailureLines,
} from "#/lib/_internal/render-failure";

// Imported for its side effect, the pool's warm-up, so that it runs on a new
// task's first request, the load balancer's health check (ADR-0052).
import "#/db";

const handler = defineHandlerCallback((ctx) => {
  const { matches } = ctx.router.state;
  for (const line of renderFailureLines(matches)) {
    console.error(line);
  }
  if (refusedByRole(matches)) {
    setResponseStatus(403);
  }
  return defaultStreamHandler(ctx);
});

export default createServerEntry({ fetch: createStartHandler(handler) });
