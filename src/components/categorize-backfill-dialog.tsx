import { useRouter } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import {
  categorizeNextProject,
  countUncategorizedProjects,
} from "#/server/categories";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { FieldError } from "./ui/field";

interface Tally {
  categorized: number;
  failed: number;
  skipped: number;
}

const EMPTY: Tally = { categorized: 0, failed: 0, skipped: 0 };

type Step = Awaited<ReturnType<typeof categorizeNextProject>>;

function tallied(tally: Tally): number {
  return tally.categorized + tally.failed + tally.skipped;
}

/**
 * The categorization backfill (#31): one button on `/admin/categories` that
 * files every published or archived project with no categories, one project
 * per server call, with a running count and a stop button. The browser drives
 * the loop, as placement runs in the browser (ADR-0056), so closing the
 * dialog is the stop and nothing keeps running on the server. A stopped run
 * starts again where it stopped, because a categorized project is no longer
 * picked.
 *
 * The cursor resets with each run, so a project the model failed on is tried
 * once more per run and never twice in one.
 */
export function CategorizeBackfillDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [tally, setTally] = useState<Tally>(EMPTY);
  const [last, setLast] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aborted by Stop, by closing the dialog and by leaving the page; the loop
  // checks it between projects, so the project in flight finishes and nothing
  // after it starts. Cleared when the dialog reopens, so a loop still waiting
  // on its last project cannot write into the fresh counts.
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);

  async function load() {
    run.current = null;
    setTotal(null);
    setTally(EMPTY);
    setLast(null);
    setFinished(false);
    setError(null);
    try {
      setTotal((await countUncategorizedProjects()).count);
    } catch (e) {
      setError(errorMessage(e, "Could not count the uncategorized projects."));
    }
  }

  async function start() {
    const controller = new AbortController();
    run.current = controller;
    const current = () => run.current === controller;
    setRunning(true);
    setFinished(false);
    setError(null);
    setTally(EMPTY);
    let after: string | null = null;
    try {
      // Counted again, since the last run filed some of them.
      setTotal((await countUncategorizedProjects()).count);
      while (!controller.signal.aborted) {
        const step: Step = await categorizeNextProject({ data: { after } });
        if (!current()) {
          break;
        }
        if (step.done) {
          setFinished(true);
          break;
        }
        after = step.projectId;
        setLast(step.title);
        setTally((t) => {
          if (step.outcome === "updated") {
            return { ...t, categorized: t.categorized + 1 };
          }
          if (step.outcome === "failed") {
            return { ...t, failed: t.failed + 1 };
          }
          return { ...t, skipped: t.skipped + 1 };
        });
      }
    } catch (e) {
      if (current()) {
        setError(errorMessage(e, "The run stopped on an error."));
      }
    } finally {
      if (current() || run.current === null) {
        setRunning(false);
      }
      // The Projects column on the table behind the dialog.
      void router.invalidate();
    }
  }

  function onOpenChange(next: boolean) {
    if (next) {
      void load();
    } else {
      run.current?.abort();
    }
    setOpen(next);
  }

  const done = tallied(tally);
  let status: string | null = null;
  if (total !== null && (running || done > 0)) {
    status = `${done} of ${total} done: ${tally.categorized} categorized, ${tally.failed} failed${tally.skipped ? `, ${tally.skipped} skipped` : ""}.`;
  }
  if (finished) {
    status = `Done. ${tally.categorized} categorized, ${tally.failed} failed${tally.skipped ? `, ${tally.skipped} skipped` : ""}.`;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <Sparkles aria-hidden="true" />
          Categorize uncategorized
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Categorize uncategorized projects</DialogTitle>
          <DialogDescription>
            AI picks categories for each published or archived project that has
            none, one project at a time, and writes them straight to its public
            page. Fix any on the project's staff panel.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm">
            {total === null
              ? "Counting..."
              : `${total} ${total === 1 ? "project has" : "projects have"} no categories.`}
          </p>
          {total !== null && total > 0 && (
            <progress
              aria-label="Projects done"
              className="accent-primary h-2 w-full"
              max={total}
              value={Math.min(done, total)}
            />
          )}
          <output aria-live="polite" className="block text-sm">
            {status}
          </output>
          {last && (
            <p className="text-muted-foreground truncate text-xs">
              Last: {last}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            Closing this dialog stops the run. Starting again picks up the
            projects still without categories.
          </p>
          <FieldError message={error} />
        </DialogBody>
        <DialogFooter>
          {running ? (
            <Button
              onClick={() => run.current?.abort()}
              type="button"
              variant="outline"
            >
              Stop
            </Button>
          ) : (
            <Button
              disabled={!total || finished}
              onClick={() => void start()}
              type="button"
            >
              {done > 0 && !finished ? "Start again" : "Start"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
