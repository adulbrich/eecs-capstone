/**
 * Runs on every response and, at most once a minute per task, starts the
 * sweep that sends the proposer edit notice (#839). Why a request starts it
 * rather than a timer is ADR-0071; the throttle is in
 * `src/lib/_internal/sweep-trigger.ts` and the sweep in
 * `src/server/_internal/staff-edit-emails.ts`. This file only registers the
 * hook, the same split as `asset-error-headers.ts`.
 *
 * The sweep is imported on first use, so a task that never serves a request
 * never loads it, and its failure is logged rather than reaching the response.
 */

import { definePlugin } from "nitro";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import { createSweepTrigger } from "#/lib/_internal/sweep-trigger";
import { SWEEP_EVERY_MS } from "#/lib/staff-edit-email";

const startSweep = createSweepTrigger({
  everyMs: SWEEP_EVERY_MS,
  onError: (error) =>
    console.error("Staff edit email sweep failed", redactQueryError(error)),
  run: async () => {
    const { runStaffEditEmailSweep } = await import(
      "#/server/_internal/staff-edit-emails"
    );
    await runStaffEditEmailSweep();
  },
});

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", () => {
    startSweep();
  });
});
