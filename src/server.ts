/**
 * TanStack Start's server entry, replacing the default one only to add a
 * log line for a failed server render (#602); `renderFailureLines` says why
 * this is the one place that sees every route's failure. Nitro loads this on
 * the first request rather than at boot (docs/QUIRKS.md, TanStack Start), so
 * nothing that must run at boot belongs here.
 */

import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { renderFailureLines } from "#/lib/_internal/render-failure";

// Imported for its side effect: evaluating `#/db` opens the pool's warm
// floor, and importing it here makes that happen on a new task's first
// request, the load balancer's health check, rather than on the first page
// view of a burst (#601).
import "#/db";

const handler = defineHandlerCallback((ctx) => {
  for (const line of renderFailureLines(ctx.router.state.matches)) {
    console.error(line);
  }
  return defaultStreamHandler(ctx);
});

export default createServerEntry({ fetch: createStartHandler(handler) });
