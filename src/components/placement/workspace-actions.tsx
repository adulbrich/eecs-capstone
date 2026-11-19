import {
  ChevronDown,
  Download,
  FolderOpen,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { useFilePicker } from "#/components/placement/file-picker-button";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { FieldError } from "#/components/ui/field";
import { downloadText } from "#/lib/placement/download";
import {
  isEmptyWorkspace,
  parseWorkspace,
  serializeWorkspace,
  type Workspace,
} from "#/lib/placement/workspace";

const IMPORT_CONFIRM = {
  busyLabel: "Opening...",
  confirmLabel: "Choose file",
  description:
    "The projects, bids and settings on this page are replaced by the workspace file you choose next. Export this one first to keep it.",
  title: "Replace this workspace?",
};
const CLEAR_CONFIRM = {
  busyLabel: "Clearing...",
  confirmLabel: "Clear",
  description:
    "Removes the projects, bids and settings from this browser. Export the workspace first to keep a copy.",
  title: "Clear all placement data?",
};

/**
 * Moving a workspace to another browser, and ending it. Import and clear
 * each replace what is on the page, so both confirm first when there is
 * something to lose. From `md` up they are three buttons; below it they are
 * one Workspace menu beside Analytics (#739), so the header takes one row on
 * a phone rather than three.
 */
export function WorkspaceActions({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const [error, setError] = useState<string | null>(null);
  // Controlled so a confirmed action closes it: left open, the menu sits
  // behind the file picker and keeps focus on an item now disabled.
  const [menuOpen, setMenuOpen] = useState(false);
  const picker = useFilePicker({
    accept: ".json,application/json",
    inputLabel: "Workspace file",
    onText: (text) => {
      const parsed = parseWorkspace(text);
      if (parsed.ok) {
        setError(null);
        state.replace(parsed.workspace, parsed.notices);
      } else {
        setError(parsed.message);
      }
    },
  });
  const empty = isEmptyWorkspace(workspace);
  const exportWorkspace = () =>
    downloadText(
      `placement-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      serializeWorkspace(workspace),
      "application/json"
    );
  const clear = () => {
    setError(null);
    state.clear();
  };
  // An empty workspace has nothing to lose, so Import opens the picker at
  // once; otherwise it asks first.
  const confirmImport = (trigger: ReactNode, onConfirm = picker.open) =>
    empty ? (
      trigger
    ) : (
      <ConfirmDialog {...IMPORT_CONFIRM} onConfirm={onConfirm}>
        {trigger}
      </ConfirmDialog>
    );
  const fromMenu = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="hidden flex-wrap justify-end gap-2 md:flex">
        <Button
          disabled={empty}
          onClick={exportWorkspace}
          size="sm"
          type="button"
          variant="outline"
        >
          <Download aria-hidden="true" />
          Export workspace
        </Button>
        {confirmImport(
          <Button
            onClick={empty ? picker.open : undefined}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload aria-hidden="true" />
            Import workspace
          </Button>
        )}
        <ConfirmDialog {...CLEAR_CONFIRM} onConfirm={clear}>
          <Button
            disabled={empty}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" />
            Clear all data
          </Button>
        </ConfirmDialog>
      </div>
      {/* Not modal, as the Columns menu is not (admin-data-table.tsx): a
          modal menu hides the rest of the page from assistive tech. */}
      <div className="md:hidden">
        <DropdownMenu modal={false} onOpenChange={setMenuOpen} open={menuOpen}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" type="button" variant="outline">
              <FolderOpen aria-hidden="true" />
              Workspace
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={empty} onSelect={exportWorkspace}>
              <Download aria-hidden="true" />
              Export workspace
            </DropdownMenuItem>
            {/* A confirm is kept open on select, so the dialog it opens is
                not unmounted with the menu. */}
            {confirmImport(
              <DropdownMenuItem
                onSelect={(event) => {
                  if (empty) {
                    picker.open();
                  } else {
                    event.preventDefault();
                  }
                }}
              >
                <Upload aria-hidden="true" />
                {empty ? "Import workspace" : "Import workspace..."}
              </DropdownMenuItem>,
              fromMenu(picker.open)
            )}
            {/* Disabled with no confirm around it: the dialog's trigger would
                open it on a synthesized click, which skips the disabled
                check Radix runs on select. */}
            {empty ? (
              <DropdownMenuItem disabled={true} variant="destructive">
                <Trash2 aria-hidden="true" />
                Clear all data
              </DropdownMenuItem>
            ) : (
              <ConfirmDialog {...CLEAR_CONFIRM} onConfirm={fromMenu(clear)}>
                <DropdownMenuItem
                  onSelect={(event) => event.preventDefault()}
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" />
                  Clear all data...
                </DropdownMenuItem>
              </ConfirmDialog>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {picker.input}
      <FieldError message={error ?? picker.error} />
    </div>
  );
}
