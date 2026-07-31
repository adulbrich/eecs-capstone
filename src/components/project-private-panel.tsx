import {
  PRIVATE_NOTES_LABEL,
  PRIVATE_PANEL_AUDIENCE_HINT,
} from "#/lib/private-notes";
import { CommentThread } from "./comment-thread";
import { Panel, PanelHeader, PanelNote, PanelSection } from "./panel";
import { StatusTimeline } from "./status-timeline";

type Comment = Parameters<typeof CommentThread>[0]["comments"][number];
type HistoryRow = Parameters<typeof StatusTimeline>[0]["rows"][number];

/**
 * Everything on the project page that the proposer and staff share and the
 * public never sees, in one bordered region with a single audience statement,
 * so the boundary is structural rather than something each section has to
 * re-explain.
 *
 * Neutral tone, not the staff panel's brand tint: a staff viewer renders both,
 * stacked, and identical borders would read as one region.
 */
export function ProjectPrivatePanel({
  comments,
  history,
  notes,
  onCommentsChanged,
  projectId,
  viewerIsStaff,
}: {
  comments: Comment[];
  history: HistoryRow[];
  notes: string | null;
  onCommentsChanged: () => void;
  projectId: string;
  viewerIsStaff: boolean;
}) {
  return (
    <Panel tone="private">
      <PanelHeader title="Private" />
      <PanelNote>{PRIVATE_PANEL_AUDIENCE_HINT}</PanelNote>

      {notes && (
        <PanelSection title={PRIVATE_NOTES_LABEL}>
          <p className="whitespace-pre-wrap text-sm">{notes}</p>
        </PanelSection>
      )}

      <PanelSection title="Status history">
        <StatusTimeline rows={history} />
      </PanelSection>

      <PanelSection title="Comments">
        <CommentThread
          comments={comments}
          onChanged={onCommentsChanged}
          projectId={projectId}
          viewerIsStaff={viewerIsStaff}
        />
      </PanelSection>
    </Panel>
  );
}
