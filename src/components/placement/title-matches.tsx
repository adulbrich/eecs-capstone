import { Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { UnmatchedTitle } from "#/lib/placement/csv";
import { rankProjects, suggestProject } from "#/lib/placement/match";
import type { WorkspaceProject } from "#/lib/placement/types";
import type { TitleMatch, TitleMatches } from "#/lib/placement/workspace";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The bid titles that name no project, each with the closest projects to
 * match it to, and the matches already made, each undoable (#661). A match
 * is stored in the workspace and applied when the bids are parsed; the file
 * is never rewritten.
 */
export function TitleMatchesPanel({
  matches,
  onMatch,
  onUndo,
  projects,
  unmatched,
}: {
  matches: TitleMatches | undefined;
  onMatch: (added: TitleMatches) => void;
  onUndo: (key: string) => void;
  projects: readonly WorkspaceProject[];
  unmatched: readonly UnmatchedTitle[];
}) {
  // What staff picked, by normalized title; a title nobody picked shows its
  // suggestion.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const candidates = useMemo(
    () =>
      unmatched.map((entry) => {
        const ranked = rankProjects(entry.title, projects);
        return { entry, ranked, suggestion: suggestProject(ranked) };
      }),
    [unmatched, projects]
  );
  const titles = new Map(projects.map((p) => [p.key, p.title]));
  const made = Object.entries(matches ?? {}).filter(([, m]) =>
    titles.has(m.projectKey)
  );
  if (unmatched.length === 0 && made.length === 0) {
    return null;
  }

  const selected = (key: string, suggested: string | undefined) =>
    picked[key] ?? suggested ?? "";
  const match = (entry: UnmatchedTitle, projectKey: string): TitleMatch => ({
    projectKey,
    title: entry.title,
  });
  const withSuggestion = candidates.filter((c) => c.suggestion !== undefined);
  const leftOut = unmatched.reduce((n, u) => n + u.rows.length, 0);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {unmatched.length > 0 && (
        <section
          aria-label="Unmatched titles"
          className="rounded-md border border-destructive/40 px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {plural(unmatched.length, "title matches", "titles match")} no
              project{" "}
              <span className="font-normal text-muted-foreground">
                ({plural(leftOut, "bid", "bids")} left out)
              </span>
            </p>
            {withSuggestion.length > 0 && (
              <Button
                onClick={() =>
                  onMatch(
                    Object.fromEntries(
                      withSuggestion.map((c) => [
                        c.entry.key,
                        match(
                          c.entry,
                          selected(c.entry.key, c.suggestion?.key)
                        ),
                      ])
                    )
                  )
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Match all suggestions
              </Button>
            )}
          </div>
          <ul className="mt-2 flex flex-col gap-3">
            {candidates.map(({ entry, ranked, suggestion }) => {
              const value = selected(entry.key, suggestion?.key);
              return (
                <li key={entry.key}>
                  <p>
                    "{entry.title}"{" "}
                    <span className="text-muted-foreground">
                      {plural(entry.rows.length, "bid", "bids")}
                    </span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Select
                      onValueChange={(key) =>
                        setPicked((p) => ({ ...p, [entry.key]: key }))
                      }
                      value={value}
                    >
                      <SelectTrigger
                        aria-label={`Project for "${entry.title}"`}
                        className="w-full min-w-0 sm:w-96"
                        size="sm"
                      >
                        <SelectValue placeholder="Pick a project" />
                      </SelectTrigger>
                      <SelectContent>
                        {ranked.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {c.title} ({Math.round(c.score * 100)}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      aria-label={`Match "${entry.title}"`}
                      disabled={value === ""}
                      onClick={() =>
                        onMatch({ [entry.key]: match(entry, value) })
                      }
                      size="sm"
                      type="button"
                    >
                      Match
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {made.length > 0 && (
        <section
          aria-label="Titles matched by hand"
          className="rounded-md border px-3 py-2 text-sm"
        >
          <p className="font-medium">Matched by hand</p>
          <ul className="mt-1 flex flex-col gap-1">
            {made.map(([key, m]) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2"
                key={key}
              >
                <span>
                  "{m.title}"{" "}
                  <span className="text-muted-foreground">matched to</span>{" "}
                  {titles.get(m.projectKey)}
                </span>
                <Button
                  aria-label={`Undo the match for "${m.title}"`}
                  onClick={() => onUndo(key)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Undo2 aria-hidden="true" />
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
