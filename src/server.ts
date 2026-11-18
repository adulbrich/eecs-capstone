/**
 * TanStack Start's server entry, replacing the default one to add a log line
 * for a failed server render (#602), a 403 for the access-denied page (#606),
 * and the start of the proposer edit notice's sweep (#839);
 * `renderFailureLines` says why this is the one place that sees every
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
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import {
  refusedByRole,
  renderFailureLines,
} from "#/lib/_internal/render-failure";
import { createSweepTrigger } from "#/lib/_internal/sweep-trigger";
import { SWEEP_EVERY_MS } from "#/lib/staff-edit-email";
import { runStaffEditEmailSweep } from "#/server/_internal/staff-edit-emails";

// Imported for its side effect, the pool's warm-up, so that it runs on a new
// task's first request, the load balancer's health check (ADR-0052).
import "#/db";

const handler = defineHandlerCallback(async (ctx) => {
  const { matches } = ctx.router.state;
  for (const line of renderFailureLines(matches)) {
    console.error(line);
  }
  const rendered = await defaultStreamHandler(ctx);
  // Start applies a `setResponseStatus` status to the response returned here,
  // streamed or not. Set it only after the render succeeds: if the render
  // throws, Start answers with any 4xx already set, and a crash should be 500.
  if (refusedByRole(matches)) {
    setResponseStatus(403);
  }
  return rendered;
});

const startHandler = createStartHandler(handler);

/**
 * At most once a minute per task, after any request this entry answers, the
 * load balancer's health check included (ADR-0071). Here rather than in a
 * Nitro `response` hook: a Nitro plugin is bundled apart from the app, so the
 * sweep it imported got its own copy of `#/db` and a second pool
 * (docs/QUIRKS.md, TanStack Start). The sweep never throws; the trigger's
 * `onError` is for a bug in it.
 */
const startStaffEditEmailSweep = createSweepTrigger({
  everyMs: SWEEP_EVERY_MS,
  onError: (error) =>
    console.error("Staff edit email sweep failed", redactQueryError(error)),
  run: () => runStaffEditEmailSweep(),
});

export default createServerEntry({
  fetch: async (...args: Parameters<typeof startHandler>) => {
    try {
      return await startHandler(...args);
    } finally {
      startStaffEditEmailSweep();
    }
  },
});
