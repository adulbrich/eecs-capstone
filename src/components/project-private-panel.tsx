import { PRIVATE_NOTES_LABEL } from "#/lib/private-notes";
import { CommentThread } from "./comment-thread";
import { SectionHeading } from "./section-heading";
import { StatusTimeline } from "./status-timeline";

type Comment = Parameters<typeof CommentThread>[0]["comments"][number];
type HistoryRow = Parameters<typeof StatusTimeline>[0]["rows"][number];

/**
 * Everything on the project page that the proposer and staff share and the
 * public never sees, in one bordered region with a single audience statement,
 * so the boundary is structural rather than something each section has to
 * re-explain.
 *
 * Deliberately NOT brand-tinted like the staff panel: a staff viewer renders
 * both, stacked, and identical borders would read as one region and defeat the
 * separation. Neutral border here, brand tint reserved for staff-only.
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
    <div className="mt-8 rounded-lg border border-border bg-(--surface-sunken) p-4">
      <SectionHeading>Private</SectionHeading>
      <p className="mt-1 text-muted-foreground text-sm">
        Only visible to you and program staff. Never shown publicly.
      </p>

      {notes && (
        <section className="mt-5 border-border border-t pt-4">
          <h3 className="font-medium text-sm">{PRIVATE_NOTES_LABEL}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{notes}</p>
        </section>
      )}

      <section className="mt-5 border-border border-t pt-4">
        <h3 className="font-medium text-sm">Status history</h3>
        <div className="mt-2">
          <StatusTimeline rows={history} />
        </div>
      </section>

      <section className="mt-5 border-border border-t pt-4">
        <h3 className="font-medium text-sm">Comments</h3>
        <div className="mt-2">
          <CommentThread
            comments={comments}
            onChanged={onCommentsChanged}
            projectId={projectId}
            viewerIsStaff={viewerIsStaff}
          />
        </div>
      </section>
    </div>
  );
}
