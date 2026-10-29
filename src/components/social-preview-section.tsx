import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  SOCIAL_SUMMARY_MAX_LENGTH,
  SOCIAL_SUMMARY_TOO_LONG_MESSAGE,
  type SocialSummaryView,
  socialSummaryLength,
} from "#/lib/social-summary";
import {
  DRAFT_QUERY_OPTIONS,
  staffProjectKeys,
  staffRead,
  useSeedOnArrival,
} from "#/lib/staff-project-queries";
import { useAction } from "#/lib/use-action";
import {
  getSocialSummary,
  regenerateSocialSummary,
  saveSocialSummary,
} from "#/server/social-summary";
import { AttemptFailed, AttemptNote, triggerPhrase } from "./ai-attempt";
import { LocalTime } from "./local-time";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Textarea } from "./ui/textarea";

const LOAD_FAILED =
  "Could not load the stored summary. Nothing here is safe to act on until it loads.";

const RACE_LOST =
  "The project or its summary changed while the rewrite was running, so the rewrite was thrown away. The box shows what is stored now.";

/**
 * The stored wording goes last, quoted, so a summary with or without a closing
 * full stop never runs into the next sentence.
 */
function saveLost(stored: string | null): string {
  const lead =
    "The stored summary changed after this page loaded it, so yours was not saved. Your wording is still in the box";
  return stored === null
    ? `${lead}, and Save again stores it.`
    : `${lead}, and Save again replaces what is stored now: "${stored}"`;
}

/**
 * Regenerate is enabled when staff own the wording, when there is none at
 * all, and when the last rewrite failed. The second and third are the
 * Bedrock outage: without them the panel would show an empty box, or a
 * summary of older text beside a failure (#631), with two dead buttons and no
 * way out.
 */
function canRegenerate(view: SocialSummaryView): boolean {
  return (
    view.isManual ||
    view.summary === null ||
    view.summaryAttempt?.outcome === "failed"
  );
}

/**
 * The last automatic or staff rewrite, when it says something the meta line
 * does not (#631). Nothing for a manual summary, which the automatic path
 * never touches, and nothing for a success, which the meta line's
 * "Generated" time already shows.
 */
function SummaryAttemptStatus({ view }: { view: SocialSummaryView }) {
  if (view.isManual) {
    return null;
  }
  const attempt = view.summaryAttempt;
  if (attempt?.outcome === "failed") {
    return (
      <AttemptFailed>
        The last rewrite failed {triggerPhrase(attempt.trigger, "Regenerate")},{" "}
        <LocalTime value={attempt.at} />.{" "}
        {view.summary === null
          ? "Until one succeeds, previews use the start of the project's description."
          : "The summary above is the last one written."}{" "}
        Regenerate with AI tries again.
      </AttemptFailed>
    );
  }
  if (attempt?.outcome === "superseded") {
    return (
      <AttemptNote>
        The last rewrite, <LocalTime value={attempt.at} />, was dropped because
        the project changed while it ran.
      </AttemptNote>
    );
  }
  if (attempt || view.summary !== null) {
    return null;
  }
  // The switch first: with it off, "once published" would promise a write
  // nothing will make.
  if (!view.automaticEnabled) {
    return (
      <AttemptNote>
        Automatic summaries are switched off. Regenerate with AI still works.
      </AttemptNote>
    );
  }
  return (
    <AttemptNote>
      {view.refreshable
        ? "No automatic attempt on record yet."
        : "Written automatically once the project is published."}
    </AttemptNote>
  );
}

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
 * Read through a query keyed on the project, so one project's wording is
 * never shown over another's, however late it answers.
 */
export function SocialPreviewSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const queryKey = staffProjectKeys.socialSummary(projectId);
  const query = useQuery({
    queryKey,
    queryFn: () => staffRead(() => getSocialSummary({ data: { projectId } })),
    ...DRAFT_QUERY_OPTIONS,
  });
  const [draft, setDraft] = useState("");
  useSeedOnArrival(projectId, query.data, (first) =>
    setDraft(first.summary ?? "")
  );
  const [notice, setNotice] = useState<string | null>(null);
  // A second activation in the same tick would spend a second model call;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run } = useAction({ fallback: "Social summary failed" });

  // Its own state, not a stand-in for an empty row (#564). Reading a failed
  // load as "nothing stored" enabled Regenerate, because that button turns on
  // when the summary is null, and Regenerate is the call that clears a summary
  // staff wrote by hand. A transient error on a read must not offer a write.
  const failed = query.data === undefined && query.isError && !query.isFetching;
  const loaded = query.data ?? null;

  /** Stores what a write answered and sets the box from it. */
  function show(next: SocialSummaryView) {
    queryClient.setQueryData(queryKey, next);
    setDraft(next.summary ?? "");
  }

  function retry() {
    setNotice(null);
    void query.refetch();
  }
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
  // `loaded` is null while the load is in flight and after it failed, so
  // neither state offers either button.
  const regenerateAllowed = !!loaded && canRegenerate(loaded);

  function save() {
    if (!loaded) {
      return;
    }
    return run(async () => {
      setNotice(null);
      const next = await saveSocialSummary({
        data: {
          projectId,
          summary: trimmed,
          expected: { summary: loaded.summary, isManual: loaded.isManual },
        },
      });
      // A miss that already stores this wording, by hand, is a save: this
      // tab's earlier save landed with its answer lost, or a colleague typed
      // the same. Telling staff theirs was lost would be wrong, and the
      // "Save again" it offers would be disabled.
      if (
        next.outcome === "saved" ||
        (next.isManual && next.summary === trimmed)
      ) {
        show(next);
        return;
      }
      // Lost to another save (#583). The stored view moves so the meta line
      // and the next Save's `expected` are current, but the draft stays: it
      // is wording someone typed and nothing has kept it. The stored wording
      // goes in the notice instead, so both are on screen and a second Save
      // replaces the colleague's knowingly.
      queryClient.setQueryData(queryKey, next);
      setNotice(saveLost(next.summary));
    }, "Could not save the summary");
  }

  function regenerate() {
    return run(async () => {
      setNotice(null);
      const next = await regenerateSocialSummary({ data: { projectId } });
      show(next);
      // The server refused to overwrite a row that moved under it. Said out
      // loud, because the box is about to show wording nobody in this tab
      // asked for.
      setNotice(next.outcome === "changed" ? RACE_LOST : null);
    }, "Could not rewrite the summary");
  }

  if (!(loaded || failed)) {
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
      {loaded && <SummaryAttemptStatus view={loaded} />}
      {tooLong && <FieldError message={SOCIAL_SUMMARY_TOO_LONG_MESSAGE} />}
      {failed && <FieldError message={LOAD_FAILED} />}
      <FieldError message={error} />
      {/*
        A FieldError rather than a SavedNote or a paragraph of its own, per
        "Where the success goes" in docs/UI-CONVENTIONS.md. A Regenerate or a
        Save that lost a race did not fail, but it did not do what was asked
        either: what was asked for was not stored, and a reader who cannot see
        the box would otherwise be told nothing at all. That is the case
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
          disabled={busy || !regenerateAllowed}
          onClick={() => void regenerate()}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? "Working..." : "Regenerate with AI"}
        </Button>
        {failed && (
          <Button onClick={retry} size="sm" type="button" variant="outline">
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
