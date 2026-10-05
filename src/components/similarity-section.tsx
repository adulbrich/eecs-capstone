import { useCallback, useEffect, useState } from "react";
import type {
  RecomputeSimilarityResult,
  SimilarityView,
} from "#/lib/ai-refresh";
import { useAction } from "#/lib/use-action";
import { getSimilarity, recomputeSimilarity } from "#/server/similarity";
import { AttemptFailed, AttemptNote, triggerPhrase } from "./ai-attempt";
import { LocalTime } from "./local-time";
import { Button } from "./ui/button";
import { FieldError, SavedNote } from "./ui/field";

const LOAD_FAILED = "Could not load the similarity status.";

const MISSING =
  "Until it is, this project is missing from Similar projects and sorts last in Recommended for you.";

/**
 * What Recompute reports beyond the status line, which already shows the
 * outcome and its time. A failure is in the status box; these are the three
 * outcomes that box cannot explain, because they are about the click rather
 * than the project.
 */
const OUTCOME_NOTICE: Partial<
  Record<RecomputeSimilarityResult["outcome"], string>
> = {
  skipped:
    "Nothing was computed: the project is no longer published or archived.",
  superseded:
    "The project changed while this ran, so the result was dropped. The change started its own.",
  unchanged: "Already up to date, so nothing was recomputed.",
};

/**
 * The staff view of a project's similarity (#631): whether its embedding is
 * computed, the last attempt at it, and a way to retry after a failure.
 *
 * Its own section rather than part of Social preview, because the embedding
 * feeds two things neither of which is the preview card: Similar projects on
 * other project pages, and the Recommended for you sort. "Similarity" is the
 * name for both (CONTEXT.md); the copy never says "embedding".
 *
 * Recompute appears only when it can change something: after a failure, or
 * with nothing computed. On a current vector the writer would return
 * `unchanged` without a call, and a button that does nothing is worse than
 * none.
 */
export function SimilaritySection({ projectId }: { projectId: string }) {
  const [view, setView] = useState<SimilarityView | "loading" | "failed">(
    "loading"
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { busy, error, run } = useAction({ fallback: "Recompute failed" });

  const load = useCallback(async () => {
    setView("loading");
    try {
      setView(await getSimilarity({ data: { projectId } }));
    } catch {
      setView("failed");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function recompute() {
    return run(async () => {
      setNotice(null);
      setSaved(null);
      const result = await recomputeSimilarity({ data: { projectId } });
      setView(result);
      setNotice(OUTCOME_NOTICE[result.outcome] ?? null);
      setSaved(result.outcome === "updated" ? "Recomputed." : null);
    }, "Could not recompute similarity");
  }

  if (view === "loading") {
    return <p className="text-muted-foreground text-sm">Loading...</p>;
  }
  if (view === "failed") {
    return (
      <div className="space-y-3">
        <FieldError message={LOAD_FAILED} />
        <Button
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    );
  }

  const canRecompute =
    view.refreshable &&
    (view.computedAt === null || view.attempt?.outcome === "failed");

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Computed by AI from the title, description and other project text. It
        places this project under Similar projects on other project pages and
        orders it in Recommended for you. It is recomputed automatically when
        that text changes on a published or archived project.
      </p>
      <SimilarityStatus view={view} />
      <FieldError message={error} />
      <FieldError message={notice} />
      <SavedNote message={saved} />
      {canRecompute && (
        <Button
          disabled={busy}
          onClick={() => void recompute()}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? "Working..." : "Recompute"}
        </Button>
      )}
    </div>
  );
}

function SimilarityStatus({ view }: { view: SimilarityView }) {
  const { attempt, computedAt } = view;
  if (attempt?.outcome === "failed") {
    return (
      <AttemptFailed>
        The last attempt failed {triggerPhrase(attempt.trigger, "Recompute")},{" "}
        <LocalTime value={attempt.at} />.{" "}
        {computedAt === null
          ? `Nothing is computed. ${MISSING}`
          : "Similar projects and Recommended for you still use the text from before the last change."}
      </AttemptFailed>
    );
  }
  if (attempt?.outcome === "superseded") {
    return (
      <AttemptNote>
        The last attempt, <LocalTime value={attempt.at} />, was dropped because
        the project changed while it ran.
      </AttemptNote>
    );
  }
  if (computedAt !== null) {
    return (
      <AttemptNote>
        Computed <LocalTime value={computedAt} />
        {attempt?.trigger === "staff" ? " from Recompute" : ""}.
        {view.refreshable
          ? ""
          : " Not recomputed while the project is not published or archived."}
      </AttemptNote>
    );
  }
  return (
    <AttemptNote>
      {view.refreshable
        ? `Not computed yet. ${MISSING}`
        : "Computed once the project is published."}
    </AttemptNote>
  );
}
