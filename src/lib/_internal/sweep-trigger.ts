/**
 * A request-started sweep's throttle: the returned function starts `run` at
 * most once per `everyMs`, never while the last run is still going, and never
 * makes its caller wait. The server entry calls it after every request it
 * answers, so its cost is one clock read and a compare (ADR-0071).
 *
 * The interval counts from a run's start, not its end, so a slow sweep does
 * not stretch the cadence; single flight is what stops two overlapping.
 * Errors go to `onError` and never reach the response that happened to start
 * the run. No timer: nothing runs between requests, which is ADR-0005's line.
 *
 * Called from `src/server.ts`; the logic lives here so a unit test can drive
 * it with a fake clock and no server.
 */
export function createSweepTrigger(opts: {
  everyMs: number;
  now?: () => number;
  onError: (error: unknown) => void;
  run: () => Promise<unknown>;
}): () => void {
  const now = opts.now ?? Date.now;
  let lastStart = Number.NEGATIVE_INFINITY;
  let running = false;
  return () => {
    const t = now();
    if (running || t - lastStart < opts.everyMs) {
      return;
    }
    lastStart = t;
    running = true;
    // A synchronous throw from `run` lands in the catch too, by way of the
    // async wrapper, so nothing escapes into the hook.
    (async () => opts.run())()
      .catch(opts.onError)
      .finally(() => {
        running = false;
      });
  };
}
