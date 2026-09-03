import { useEffect, useState } from "react";
import {
  confidenceLabel,
  SCOPE_VERDICT_LABELS,
  type ScopeAssessmentView,
  type ScopeVerdict,
} from "#/lib/scope-assessment";
import {
  assessProjectScope,
  getScopeAssessment,
} from "#/server/scope-assessment";
import { LocalTime } from "./local-time";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

/**
 * The staff scope assessment, beside the private notes on the staff panel
 * (#61). Staff trigger it, nobody edits it, and a stale one is shown as such
 * rather than hidden or re-run: the hash check is the server's, this only
 * renders the flag.
 *
 * Keyed on `project.id` by the panel, so a param change remounts it rather
 * than showing one project's verdict over another's record.
 */

const VERDICT_TONE: Record<ScopeVerdict, "success" | "warning" | "error"> = {
  about_right: "success",
  under_scoped: "warning",
  too_large: "error",
};

function VerdictBadge({ verdict }: { verdict: ScopeVerdict }) {
  const tone = VERDICT_TONE[verdict];
  return (
    <Badge
      style={{
        color: `var(--status-${tone})`,
        backgroundColor: `var(--status-${tone}-bg)`,
      }}
      variant="status"
    >
      {SCOPE_VERDICT_LABELS[verdict]}
    </Badge>
  );
}

export function ScopeAssessmentSection({ projectId }: { projectId: string }) {
  const [view, setView] = useState<ScopeAssessmentView | null | "loading">(
    "loading"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setView(await getScopeAssessment({ data: { projectId } }));
      } catch {
        // Staff-only endpoint; a failure reads as "not assessed yet", and the
        // button below reports its own error if the write is refused too.
        setView(null);
      }
    })();
  }, [projectId]);

  async function assess() {
    setError(null);
    setBusy(true);
    try {
      setView(await assessProjectScope({ data: { projectId } }));
    } catch (e) {
      setError((e as Error)?.message || "Scope assessment failed");
    } finally {
      setBusy(false);
    }
  }

  const assessed = view !== "loading" && view !== null ? view : null;
  const confidence = assessed
    ? Math.round(assessed.assessment.confidence * 100)
    : null;

  return (
    <div className="space-y-3">
      {view === "loading" && (
        <p className="text-muted-foreground text-sm">Loading...</p>
      )}
      {view === null && (
        <p className="text-muted-foreground text-sm">
          Not assessed yet. The model judges the deliverables against a one-term
          and a three-term course, using the scope rule proposers are shown. It
          is a second opinion to argue with, not a verdict.
        </p>
      )}
      {assessed && (
        <div className="space-y-2 text-sm">
          {assessed.stale && (
            <p
              className="rounded-md px-2 py-1 text-xs"
              style={{
                color: "var(--status-warning)",
                backgroundColor: "var(--status-warning-bg)",
              }}
            >
              Assessed against an earlier version of this project. Reassess to
              judge the current text.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">One term</dt>
            <dd>
              <VerdictBadge verdict={assessed.assessment.oneTerm} />
            </dd>
            <dt className="text-muted-foreground">Three terms</dt>
            <dd>
              <VerdictBadge verdict={assessed.assessment.threeTerms} />
            </dd>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd>
              {confidence}% ({confidenceLabel(assessed.assessment.confidence)})
            </dd>
          </dl>
          <p className="whitespace-pre-wrap">{assessed.assessment.rationale}</p>
          <p className="text-muted-foreground text-xs">
            Assessed <LocalTime value={assessed.assessedAt} /> by{" "}
            {assessed.assessment.model}.
          </p>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {view !== "loading" && (
        <Button
          disabled={busy}
          onClick={() => void assess()}
          size="sm"
          type="button"
          variant="outline"
        >
          {(() => {
            if (busy) {
              return "Assessing...";
            }
            return assessed ? "Reassess" : "Assess scope";
          })()}
        </Button>
      )}
    </div>
  );
}
