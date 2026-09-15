import { Link } from "@tanstack/react-router";
import { useAction } from "#/lib/use-action";
import {
  hardDeleteProject,
  returnToDraft,
  submitProject,
} from "#/server/projects";
import { ConfirmDialog } from "./confirm-dialog";
import { SectionHeading } from "./section-heading";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { FieldError } from "./ui/field";

interface Project {
  id: string;
  status: string;
}

interface Props {
  /**
   * What staff asked for the last time they sent the project back, or null
   * when the status is not changes requested or the note is missing. The
   * route reads it off the status history it already loads for the owner, so
   * the block can say what to change beside the button that resubmits.
   */
  changeRequest: string | null;
  onChanged: () => void;
  project: Project;
}

export function OwnerProjectActions({
  changeRequest,
  project,
  onChanged,
}: Props) {
  const { busy, error, run } = useAction({ fallback: "Save failed" });

  function runTransition(action: "submit" | "withdraw") {
    void run(async () => {
      if (action === "submit") {
        await submitProject({ data: { id: project.id } });
      } else {
        await returnToDraft({ data: { id: project.id } });
      }
      onChanged();
    });
  }

  // No try/catch and no busy of its own: ConfirmDialog owns the flight and
  // shows a refusal inside the dialog rather than behind it (#410).
  async function runDelete() {
    await hardDeleteProject({ data: { id: project.id } });
    window.location.href = "/my/projects";
  }

  const buttons: Array<{
    id: "submit" | "withdraw";
    label: string;
    show: boolean;
    variant?: "default" | "outline" | "destructive";
  }> = [
    {
      id: "submit",
      label:
        project.status === "changes_requested"
          ? "Resubmit for review"
          : "Submit for review",
      show:
        project.status === "draft" || project.status === "changes_requested",
      variant: "default",
    },
    {
      id: "withdraw",
      label: "Withdraw to draft",
      show: project.status === "submitted",
      variant: "outline",
    },
  ];

  const visible = buttons.filter((b) => b.show);
  if (visible.length === 0 && !error) {
    return null;
  }

  const sentBack = project.status === "changes_requested";

  return (
    <Card asChild className="mt-6 bg-secondary p-4">
      <section>
        <SectionHeading>Your actions</SectionHeading>
        {/*
          The staff note, in the box that asks for the resubmit, so the
          proposer reads what to change before they are offered the button.
          The status history further down keeps the full record; this is the
          latest request only.
        */}
        {sentBack && (
          <div className="mt-2 text-sm">
            <p className="font-medium">Staff asked for changes</p>
            {changeRequest ? (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {changeRequest}
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">
                No note was left. Check the status history below or ask staff.
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {sentBack && (
            <Button asChild size="sm" variant="outline">
              <Link
                params={{ projectId: project.id }}
                to="/projects/$projectId/edit"
              >
                Edit project
              </Link>
            </Button>
          )}
          {visible.map((b) => (
            <Button
              disabled={busy}
              key={b.id}
              onClick={() => runTransition(b.id)}
              size="sm"
              type="button"
              variant={b.variant ?? "outline"}
            >
              {b.label}
            </Button>
          ))}
          {project.status === "draft" && (
            <ConfirmDialog
              description="This cannot be undone."
              onConfirm={runDelete}
              title="Permanently delete this draft?"
            >
              <Button
                disabled={busy}
                size="sm"
                type="button"
                variant="destructive"
              >
                Delete draft
              </Button>
            </ConfirmDialog>
          )}
        </div>
        <FieldError message={error} />
      </section>
    </Card>
  );
}
