/**
 * TanStack Start's server entry, replacing the default one only to add a
 * log line for a failed server render (#602); `renderFailureLines` says why
 * this is the one place that sees every route's failure. Nitro loads this on
 * the first request rather than at boot (docs/QUIRKS.md, TanStack Start), so
 * a check that must stop the process belongs in a Nitro plugin, not here.
 */

import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { renderFailureLines } from "#/lib/_internal/render-failure";

// Imported for its side effect, the pool's warm-up, so that it runs on a new
// task's first request, the load balancer's health check (ADR-0052).
import "#/db";

const handler = defineHandlerCallback((ctx) => {
  for (const line of renderFailureLines(ctx.router.state.matches)) {
    console.error(line);
  }
  return defaultStreamHandler(ctx);
});

export default createServerEntry({ fetch: createStartHandler(handler) });
