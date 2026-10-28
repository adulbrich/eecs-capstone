import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isRedirect, Link } from "@tanstack/react-router";
import {
  PRIVATE_NOTES_LABEL,
  PRIVATE_PANEL_AUDIENCE_HINT,
} from "#/lib/private-notes";
import { useSignedInUserId } from "#/lib/use-signed-in";
import { listProjectComments } from "#/server/projects-queries";
import { CommentThread } from "./comment-thread";
import { Panel, PanelHeader, PanelNote, PanelSection } from "./panel";
import { StatusTimeline } from "./status-timeline";
import { Button } from "./ui/button";

type Comment = Parameters<typeof CommentThread>[0]["comments"][number];
type HistoryRow = Parameters<typeof StatusTimeline>[0]["rows"][number];

/**
 * The comment key: the project, and the viewer, because what comes back
 * depends on who asks (internal comments are withheld from the proposer, and
 * `isMine` is per viewer). Writers invalidate the two-element prefix.
 */
export function projectCommentsKey(projectId: string, userId?: string) {
  return userId === undefined
    ? (["project-comments", projectId] as const)
    : (["project-comments", projectId, userId] as const);
}

/**
 * Read here rather than by the route: the detail loader carries no comments,
 * and only this panel shows them. Read again on every mount, as the route's
 * effect did, since a comment another party posts invalidates nothing in
 * this tab.
 */
function useProjectComments(projectId: string) {
  const userId = useSignedInUserId();
  const { data = [] } = useQuery({
    queryKey: projectCommentsKey(projectId, userId),
    queryFn: async () => {
      try {
        const { rows } = await listProjectComments({ data: { id: projectId } });
        return rows as Comment[];
      } catch (error) {
        // A public read, gated by `canSeeProject` rather than a session, so
        // nothing redirects today; caught all the same (docs/QUIRKS.md, "A
        // redirect thrown from a `queryFn` navigates the tab").
        if (isRedirect(error)) {
          return [];
        }
        throw error;
      }
    },
    enabled: userId !== undefined,
    staleTime: 0,
  });
  return data;
}

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
  history,
  notes,
  projectId,
  viewerIsOwner,
  viewerIsStaff,
}: {
  canEdit: boolean;
  history: HistoryRow[];
  notes: string | null;
  projectId: string;
  viewerIsOwner: boolean;
  viewerIsStaff: boolean;
}) {
  const queryClient = useQueryClient();
  const comments = useProjectComments(projectId);
  // Only the comment list rereads after a post or an edit. The loader carries
  // no comments, so invalidating the route would re-run it for nothing.
  function onCommentsChanged() {
    return queryClient.invalidateQueries({
      queryKey: projectCommentsKey(projectId),
    });
  }

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
