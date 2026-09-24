import { Link } from "@tanstack/react-router";
import {
  PRIVATE_NOTES_LABEL,
  PRIVATE_PANEL_AUDIENCE_HINT,
} from "#/lib/private-notes";
import { CommentThread } from "./comment-thread";
import { Panel, PanelHeader, PanelNote, PanelSection } from "./panel";
import { StatusTimeline } from "./status-timeline";
import { Button } from "./ui/button";

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
  canEdit,
  comments,
  history,
  notes,
  onCommentsChanged,
  projectId,
  viewerIsOwner,
  viewerIsStaff,
}: {
  canEdit: boolean;
  comments: Comment[];
  history: HistoryRow[];
  notes: string | null;
  onCommentsChanged: () => Promise<void>;
  projectId: string;
  viewerIsOwner: boolean;
  viewerIsStaff: boolean;
}) {
  return (
    <Panel tone="private">
      <PanelHeader
        actions={
          /* Teams supported left this header in #468: staff can set it from
             their own panel now, so it stopped being a number only these two
             roles could see, and it reads as a public badge beside the title
             instead. The Edit button is unmoved. */
          canEdit && (
            <Button asChild size="sm" variant="outline">
              <Link params={{ projectId }} to="/projects/$projectId/edit">
                Edit
              </Link>
            </Button>
          )
        }
        title="Private"
      />
      <PanelNote>{PRIVATE_PANEL_AUDIENCE_HINT}</PanelNote>

      {/* History first, so the notes and the comments, both written to the
          other party, sit together and read as one conversation (#615). */}
      <PanelSection title="Status history">
        <StatusTimeline rows={history} />
      </PanelSection>

      {notes && (
        <PanelSection title={PRIVATE_NOTES_LABEL}>
          <p className="whitespace-pre-wrap text-sm">{notes}</p>
        </PanelSection>
      )}

      <PanelSection title="Comments">
        <CommentThread
          comments={comments}
          onChanged={onCommentsChanged}
          projectId={projectId}
          viewerIsOwner={viewerIsOwner}
          viewerIsStaff={viewerIsStaff}
        />
      </PanelSection>
    </Panel>
  );
}
