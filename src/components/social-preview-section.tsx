import { useCallback, useEffect, useState } from "react";
import {
  SOCIAL_SUMMARY_MAX_LENGTH,
  SOCIAL_SUMMARY_TOO_LONG_MESSAGE,
  type SocialSummaryView,
  socialSummaryLength,
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

const LOAD_FAILED =
  "Could not load the stored summary. Nothing here is safe to act on until it loads.";

const RACE_LOST =
  "The summary changed while the rewrite was running, so the rewrite was thrown away. The box shows what is stored now.";

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
  const [view, setView] = useState<SocialSummaryView | "loading" | "failed">(
    "loading"
  );
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // A second activation in the same tick would spend a second model call;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run } = useAction({ fallback: "Social summary failed" });

  const load = useCallback(async () => {
    setView("loading");
    setNotice(null);
    try {
      const loaded = await getSocialSummary({ data: { projectId } });
      setView(loaded);
      setDraft(loaded.summary ?? "");
    } catch {
      // Its own state, not a stand-in for an empty row (#564). Reading a
      // failed load as "nothing stored" enabled Regenerate, because that
      // button turns on when the summary is null, and Regenerate is the call
      // that clears a summary staff wrote by hand. A transient error on a read
      // must not offer a write.
      setView("failed");
      setDraft("");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const failed = view === "failed";
  const loaded = view === "loading" || failed ? null : view;
  const stored = loaded?.summary ?? "";
  const trimmed = draft.trim();
  // Edited means "differs from what is stored", not "has been typed in": a
  // round trip back to the original text leaves nothing to save.
  const edited = trimmed !== stored.trim();
  // The cap counted the way the schema and the server count it (#565).
  // `trimmed.length` counts UTF-16 code units, so 151 emoji showed here as 302
  // over a cap the server would have accepted.
  const length = socialSummaryLength(trimmed);
  const tooLong = length > SOCIAL_SUMMARY_MAX_LENGTH;
  const canSave = !!loaded && edited && length > 0 && !tooLong;
  // Enabled when staff own the wording, and when there is none at all. The
  // second case is the Bedrock outage: without it the panel would show an
  // empty box with two dead buttons and no way out. `loaded` is null while the
  // load is in flight and after it failed, so neither state offers either
  // button.
  const canRegenerate =
    !!loaded && (loaded.isManual || loaded.summary === null);

  function save() {
    return run(async () => {
      setNotice(null);
      const saved = await saveSocialSummary({
        data: { projectId, summary: trimmed },
      });
      setView(saved);
      setDraft(saved.summary ?? "");
    }, "Could not save the summary");
  }

  function regenerate() {
    return run(async () => {
      setNotice(null);
      const next = await regenerateSocialSummary({ data: { projectId } });
      setView(next);
      setDraft(next.summary ?? "");
      // The server refused to overwrite a row that moved under it. Said out
      // loud, because the box is about to show wording nobody in this tab
      // asked for.
      setNotice(next.outcome === "changed" ? RACE_LOST : null);
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
        disabled={busy || failed}
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
          {length} / {SOCIAL_SUMMARY_MAX_LENGTH}
          {loaded?.updatedAt && (
            <>
              {" "}
              &middot; {loaded.isManual ? "Saved" : "Generated"}{" "}
              <LocalTime value={loaded.updatedAt} />
            </>
          )}
        </p>
      </div>
      {tooLong && <FieldError message={SOCIAL_SUMMARY_TOO_LONG_MESSAGE} />}
      {failed && <FieldError message={LOAD_FAILED} />}
      <FieldError message={error} />
      {/*
        A FieldError rather than a SavedNote or a paragraph of its own, per
        "Where the success goes" in docs/UI-CONVENTIONS.md. Regenerate did not
        fail, but it did not do what was asked either: the text in the box is
        not the text the model produced, and a reader who cannot see the box
        change would otherwise be told nothing at all. That is the case
        `role="alert"` exists for, and a `SavedNote` would announce it politely
        in the colour reserved for a result the reader asked for.
      */}
      <FieldError message={notice} />
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
        {failed && (
          <Button
            onClick={() => void load()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
