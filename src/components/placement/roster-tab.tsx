import { RemovedStudents } from "#/components/placement/removed-students";
import { RosterSection } from "#/components/placement/roster-section";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { setAsideRemoved, type Workspace } from "#/lib/placement/workspace";

/**
 * The class roster on its own tab (#717): who is in the class, what it
 * pre-approves, how it lines up with the bids, and who was taken out of
 * placement by hand. A run still needs the bids; the roster adds the
 * students who never answered the survey to it.
 */
export function RosterTab({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  // Named from the bids when there are any, else from the roster, so a
  // student removed before the bids were taken away can still be restored.
  const removed =
    state.bids?.removed ??
    setAsideRemoved(
      (state.roster?.entries ?? []).map((e) => ({ ...e, bids: [] })),
      workspace.removed
    ).removed;
  return (
    <div>
      {workspace.projects.length === 0 && (
        <p className="mb-4 text-muted-foreground text-sm">
          A pre-approval on the roster names its project by title, and is
          matched once the projects are loaded on the Projects tab.
        </p>
      )}
      <RosterSection state={state} workspace={workspace} />
      <RemovedStudents removed={removed} update={state.update} />
    </div>
  );
}
