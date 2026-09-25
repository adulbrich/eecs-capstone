import { Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { useFilePicker } from "#/components/placement/file-picker-button";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { downloadText } from "#/lib/placement/download";
import {
  EMPTY_WORKSPACE,
  parseWorkspace,
  serializeWorkspace,
  type Workspace,
} from "#/lib/placement/workspace";

/**
 * Moving a workspace to another browser, and ending it. Import and clear
 * each replace what is on the page, so both confirm first when there is
 * something to lose.
 */
export function WorkspaceActions({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const [error, setError] = useState<string | null>(null);
  const picker = useFilePicker({
    accept: ".json,application/json",
    inputLabel: "Workspace file",
    onText: (text) => {
      const parsed = parseWorkspace(text);
      if (parsed.ok) {
        setError(null);
        state.replace(parsed.workspace);
      } else {
        setError(parsed.message);
      }
    },
  });
  const empty = workspace === EMPTY_WORKSPACE;
  const importButton = (
    <Button
      onClick={empty ? picker.open : undefined}
      size="sm"
      type="button"
      variant="outline"
    >
      <Upload aria-hidden="true" />
      Import workspace
    </Button>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={empty}
          onClick={() =>
            downloadText(
              `placement-workspace-${new Date().toISOString().slice(0, 10)}.json`,
              serializeWorkspace(workspace),
              "application/json"
            )
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Download aria-hidden="true" />
          Export workspace
        </Button>
        {empty ? (
          importButton
        ) : (
          <ConfirmDialog
            busyLabel="Opening..."
            confirmLabel="Choose file"
            description="The projects, bids and settings on this page are replaced by the workspace file you choose next. Export this one first to keep it."
            onConfirm={picker.open}
            title="Replace this workspace?"
          >
            {importButton}
          </ConfirmDialog>
        )}
        {picker.input}
        <ConfirmDialog
          busyLabel="Clearing..."
          confirmLabel="Clear"
          description="Removes the projects, bids and settings from this browser. Export the workspace first to keep a copy."
          onConfirm={() => {
            setError(null);
            state.clear();
          }}
          title="Clear all placement data?"
        >
          <Button disabled={empty} size="sm" type="button" variant="outline">
            <Trash2 aria-hidden="true" />
            Clear all data
          </Button>
        </ConfirmDialog>
      </div>
      <FieldError message={error} />
    </div>
  );
}
