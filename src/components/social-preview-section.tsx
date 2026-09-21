import { useEffect, useState } from "react";
import {
  SOCIAL_SUMMARY_MAX_LENGTH,
  type SocialSummaryView,
} from "#/lib/social-summary";
import { useAction } from "#/lib/use-action";
import {
  getSocialSummary,
  regenerateSocialSummary,
  saveSocialSummary,
} from "#/server/social-summary";
import { LocalTime } from "./local-time";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Textarea } from "./ui/textarea";

/**
 * The staff view of a project's social summary (#498), beside the categories
 * on the staff panel.
 *
 * The summary ships publicly as the page's `og:description`, under the
 * university's name, to people who never open the page. Staff being able to
 * read it before a stranger does is the whole reason this section exists: a
 * model that garbles a sponsor's name is otherwise invisible.
 *
 * Two buttons and no third. Save stores what staff typed and marks the summary
 * manual, which stops the automatic refresh overwriting it. Regenerate hands
 * the field back to the model and clears that mark. There is no separate
 * "generate into the box" button, because Regenerate is the only path that
 * spends a model call and one spending button is easier to reason about than
 * two.
 *
 * Remounted on a param change because the route keys the whole staff panel on
 * `project.id`, so one project's wording is never shown over another's.
 */
export function SocialPreviewSection({ projectId }: { projectId: string }) {
  const [view, setView] = useState<SocialSummaryView | "loading">("loading");
  const [draft, setDraft] = useState("");
  // A second activation in the same tick would spend a second model call;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run } = useAction({ fallback: "Social summary failed" });

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await getSocialSummary({ data: { projectId } });
        setView(loaded);
        setDraft(loaded.summary ?? "");
      } catch {
        // Staff-only endpoint. A failure reads as nothing stored; the buttons
        // below report their own errors if a write is refused too.
        setView({ isManual: false, summary: null, updatedAt: null });
        setDraft("");
      }
    })();
  }, [projectId]);

  const loaded = view === "loading" ? null : view;
  const stored = loaded?.summary ?? "";
  const trimmed = draft.trim();
  // Edited means "differs from what is stored", not "has been typed in": a
  // round trip back to the original text leaves nothing to save.
  const edited = trimmed !== stored.trim();
  const tooLong = trimmed.length > SOCIAL_SUMMARY_MAX_LENGTH;
  const canSave = !!loaded && edited && trimmed.length > 0 && !tooLong;
  // Enabled when staff own the wording, and when there is none at all. The
  // second case is the Bedrock outage: without it the panel would show an
  // empty box with two dead buttons and no way out.
  const canRegenerate =
    !!loaded && (loaded.isManual || loaded.summary === null);

  function save() {
    return run(async () => {
      const saved = await saveSocialSummary({
        data: { projectId, summary: trimmed },
      });
      setView(saved);
      setDraft(saved.summary ?? "");
    }, "Could not save the summary");
  }

  function regenerate() {
    return run(async () => {
      const next = await regenerateSocialSummary({ data: { projectId } });
      setView(next);
      setDraft(next.summary ?? "");
    }, "Could not rewrite the summary");
  }

  if (view === "loading") {
    return <p className="text-muted-foreground text-sm">Loading...</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        A one-line summary used when someone shares this project in a chat app
        or on social media. It is written from the title, description and
        problem statement, and never from private notes or contact details. It
        regenerates automatically when those fields change on a published or
        archived project. Saving your own version stops that; Regenerate with AI
        hands it back.
      </p>
      {/*
        Disabled while a request is in flight, not merely the buttons. Both
        handlers set the draft from what comes back, so an edit typed during
        the wait was replaced by the server's text with nothing to say it had
        happened. Locking the field is honest about the wait; silently keeping
        the edit and discarding the response would not be.
      */}
      <Textarea
        aria-label="Social summary"
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          loaded?.summary === null
            ? "Nothing generated yet. Regenerate with AI, or write one here."
            : undefined
        }
        rows={3}
        value={draft}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {trimmed.length} / {SOCIAL_SUMMARY_MAX_LENGTH}
          {loaded?.updatedAt && (
            <>
              {" "}
              &middot; {loaded.isManual ? "Saved" : "Generated"}{" "}
              <LocalTime value={loaded.updatedAt} />
            </>
          )}
        </p>
      </div>
      {tooLong && (
        <FieldError
          message={`A summary is at most ${SOCIAL_SUMMARY_MAX_LENGTH} characters.`}
        />
      )}
      <FieldError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !canSave}
          onClick={() => void save()}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? "Working..." : "Save"}
        </Button>
        <Button
          disabled={busy || !canRegenerate}
          onClick={() => void regenerate()}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? "Working..." : "Regenerate with AI"}
        </Button>
      </div>
    </div>
  );
}
