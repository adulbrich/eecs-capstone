import { RemovedStudents } from "#/components/placement/removed-students";
import { RosterSection } from "#/components/placement/roster-section";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import type { Workspace } from "#/lib/placement/workspace";

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
  if (workspace.projects.length === 0) {
    return (
      <p className="text-sm">
        Load the projects first, on the Projects tab: a pre-approval on the
        roster names its project by title, and is matched against that list.
      </p>
    );
  }
  return (
    <div>
      <RosterSection state={state} workspace={workspace} />
      {state.bids && (
        <RemovedStudents removed={state.bids.removed} update={state.update} />
      )}
    </div>
  );
}
