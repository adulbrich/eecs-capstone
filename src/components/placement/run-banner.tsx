import { Play, Square } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";

/** What the Results tab's banner says about the run. */
export type RunBannerState =
  /** A run is in progress; Cancel stops it. */
  | { kind: "running"; students: number }
  /** Something a run needs is not loaded; the message says where. */
  | { kind: "missing"; message: string }
  /**
   * The latest run failed and the alert under the banner says why; "run
   * again" here would tell the reader to repeat what just failed (#680).
   */
  | { kind: "failed" }
  /** Nothing has run yet. */
  | { kind: "ready" }
  /** The board is the latest run, of the inputs as they are. */
  | { kind: "fresh"; at: string }
  /** The board is a run of inputs that have changed since. */
  | { kind: "stale"; at: string };

/**
 * The banner's state, in the order the page decides it: a run in progress
 * first, then what is missing, then a failure, then the board's own run.
 */
export function runBannerState({
  failed,
  missing,
  ranAt,
  running,
  stale,
  students,
}: {
  /** The latest run failed, with the inputs it read unchanged. */
  failed: boolean;
  missing: string | null;
  /** When the board's run ran, or undefined with no board. */
  ranAt: string | undefined;
  running: boolean;
  stale: boolean;
  students: number;
}): RunBannerState {
  if (running) {
    return { kind: "running", students };
  }
  if (missing !== null) {
    return { kind: "missing", message: missing };
  }
  if (failed) {
    return { kind: "failed" };
  }
  if (ranAt === undefined) {
    return { kind: "ready" };
  }
  return stale ? { kind: "stale", at: ranAt } : { kind: "fresh", at: ranAt };
}

const STALE_STYLE = {
  backgroundColor: "var(--status-warning-bg)",
  borderColor: "color-mix(in srgb, var(--status-warning) 40%, transparent)",
};
const STALE_BADGE_STYLE = {
  backgroundColor: "var(--status-warning-bg)",
  color: "var(--status-warning)",
};

/**
 * The top of the Results tab (#739): the run's state in one line, and the
 * action that changes it. The words are a live region, so a run that ends
 * says how it went.
 */
export function RunBanner({
  hasResult,
  onCancel,
  onRun,
  state,
}: {
  /** A board is on screen, so the action runs again. */
  hasResult: boolean;
  onCancel: () => void;
  onRun: () => void;
  state: RunBannerState;
}) {
  const stale = state.kind === "stale";
  return (
    <section
      aria-label="Placement run"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm"
      style={stale ? STALE_STYLE : undefined}
    >
      <p aria-live="polite" className="min-w-0">
        {stale && (
          <>
            <Badge style={STALE_BADGE_STYLE} variant="status">
              Out of date
            </Badge>{" "}
          </>
        )}
        {(state.kind === "fresh" || state.kind === "stale") && (
          <span className="font-medium">
            Ran at {new Date(state.at).toLocaleString()}.
          </span>
        )}
        {stale &&
          " The projects, parameters or bids changed since this run. Run placement again to use them."}
        {state.kind === "running" && `Placing ${state.students} students...`}
        {state.kind === "missing" && state.message}
      </p>
      {state.kind === "running" ? (
        <Button onClick={onCancel} size="sm" type="button" variant="outline">
          <Square aria-hidden="true" />
          Cancel
        </Button>
      ) : (
        <Button
          disabled={state.kind === "missing"}
          onClick={onRun}
          size="sm"
          type="button"
        >
          <Play aria-hidden="true" />
          {hasResult ? "Run placement again" : "Run placement"}
        </Button>
      )}
    </section>
  );
}
