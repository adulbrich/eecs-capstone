import { useRouter } from "@tanstack/react-router";
import { Check, WandSparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  type CleanupApplyResult,
  type CleanupKind,
  type CleanupProposal,
  describeCleanup,
} from "#/lib/category-cleanup";
import { useAction } from "#/lib/use-action";
import {
  applyCategoryCleanup,
  proposeCategoryCleanup,
} from "#/server/categories";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
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
import { FieldError, SavedNote } from "./ui/field";

const KIND_LABEL: Record<CleanupKind, string> = {
  merge: "Merge",
  rename: "Rename",
  move: "Move",
  retire: "Retire",
};

interface Row extends CleanupProposal {
  /** Null until staff apply it. */
  result: CleanupApplyResult | null;
}

function tally(rows: Row[]): string | null {
  const applied = rows.filter((r) => r.result?.ok).length;
  const refused = rows.filter((r) => r.result && !r.result.ok).length;
  if (applied + refused === 0) {
    return null;
  }
  return `${applied} applied, ${refused} refused.`;
}

/**
 * The category cleanup (#857): one button on `/admin/categories` that asks the
 * model for merges, renames, moves and retirements across the project
 * categories, and a list staff pick from. Nothing is stored: closing the
 * dialog discards the proposals.
 *
 * Opening the dialog calls nothing; Propose inside it does, as Start does in
 * the backfill dialog, because each call counts against the staff member's
 * limit and a dialog should be safe to open and read.
 *
 * Every change starts unticked, since a merge and a retirement delete a
 * category. Each applies on its own, so a refused one says why on its row and
 * the others still go through.
 */
export function CategoryCleanupDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const proposing = useAction({
    fallback: "Couldn't propose a cleanup. Try again.",
  });
  const applying = useAction({
    fallback: "Couldn't apply the changes. Try again.",
  });
  // Bumped on every close and new proposal, so an answer that arrives after
  // the dialog moved on is dropped rather than shown.
  const generation = useRef(0);

  function propose() {
    const mine = ++generation.current;
    setRows(null);
    setSelected(new Set());
    void proposing.run(async () => {
      const { proposals } = await proposeCategoryCleanup();
      if (generation.current === mine) {
        setRows(proposals.map((p) => ({ ...p, result: null })));
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      generation.current++;
      setRows(null);
      setSelected(new Set());
      proposing.setError(null);
      applying.setError(null);
    }
  }

  function toggle(index: number, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  }

  function apply() {
    if (!rows) {
      return;
    }
    const picked = [...selected].sort((a, b) => a - b);
    const mine = generation.current;
    void applying.run(async () => {
      const { results } = await applyCategoryCleanup({
        data: { changes: picked.map((i) => rows[i].operation) },
      });
      if (generation.current === mine) {
        setRows((current) =>
          (current ?? []).map((row, i) => {
            const k = picked.indexOf(i);
            return k === -1 ? row : { ...row, result: results[k] ?? null };
          })
        );
        setSelected(new Set());
      }
      // The table behind the dialog: names, types and Projects counts.
      await router.invalidate();
    });
  }

  const busy = proposing.busy || applying.busy;
  // A proposal with a change still to decide on.
  const pending = rows?.some((r) => r.result === null) ?? false;
  const proposeLabel = rows ? "Propose again" : "Propose";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <WandSparkles aria-hidden="true" />
          Propose a cleanup
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Propose a cleanup</DialogTitle>
          <DialogDescription>
            AI reads every project category with the projects it holds and
            proposes merges, renames, moves and retirements. Nothing changes
            until you tick a change and apply it. Closing this dialog discards
            the proposals.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-muted-foreground text-xs">
            A merge moves every project to the target and deletes the other
            categories; a retirement deletes the category and removes it from
            its projects. Counts are projects past draft, as in the table. A
            change that no longer matches the list is refused and the rest still
            apply. Each Propose is one AI call against your hourly limit.
          </p>
          {proposing.busy && (
            <p className="text-sm" role="status">
              Reading the category list...
            </p>
          )}
          {rows?.length === 0 && (
            <p className="text-sm">
              No changes proposed: the list looks clean.
            </p>
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-border divide-y">
              {rows.map((row, i) => (
                <ProposalRow
                  checked={selected.has(i)}
                  disabled={busy}
                  index={i}
                  // The proposal list is replaced whole, never reordered.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={i}
                  onCheckedChange={(on) => toggle(i, on)}
                  row={row}
                />
              ))}
            </ul>
          )}
          {/* Plain text: each row announces its own result. */}
          {rows && tally(rows) && <p className="text-sm">{tally(rows)}</p>}
          <FieldError message={proposing.error ?? applying.error} />
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={propose}
            type="button"
            variant={pending ? "outline" : "default"}
          >
            {proposing.busy ? "Proposing..." : proposeLabel}
          </Button>
          {pending && (
            <Button
              disabled={busy || selected.size === 0}
              onClick={apply}
              type="button"
            >
              {applying.busy
                ? "Applying..."
                : `Apply ${selected.size === 1 ? "1 change" : `${selected.size} changes`}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProposalRow({
  row,
  index,
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  index: number;
  onCheckedChange: (on: boolean) => void;
  row: Row;
}) {
  const id = `cleanup-${index}`;
  const { operation, result } = row;
  return (
    <li className="flex gap-3 py-3">
      <div className="flex w-4 shrink-0 justify-center pt-0.5">
        {result === null && (
          <Checkbox
            checked={checked}
            disabled={disabled}
            id={id}
            onCheckedChange={(state) => onCheckedChange(state === true)}
          />
        )}
        {result?.ok && (
          <Check aria-hidden="true" className="text-primary size-4" />
        )}
        {result && !result.ok && (
          <X aria-hidden="true" className="text-destructive size-4" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-start gap-2">
          <Badge variant="outline">{KIND_LABEL[operation.kind]}</Badge>
          <label className="min-w-0 flex-1 text-sm" htmlFor={id}>
            {describeCleanup(row)}
          </label>
        </div>
        {operation.kind === "rename" && operation.description && (
          <p className="text-sm">New description: {operation.description}</p>
        )}
        <p className="text-muted-foreground text-xs">{operation.reason}</p>
        <SavedNote message={result?.ok ? "Applied." : null} />
        <FieldError
          message={result && !result.ok ? `Refused: ${result.reason}` : null}
        />
      </div>
    </li>
  );
}
