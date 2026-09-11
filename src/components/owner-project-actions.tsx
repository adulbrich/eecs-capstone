import { useState } from "react";
import {
  PROJECT_STATUS_DESCRIPTION,
  PROJECT_STATUS_LABEL,
} from "#/lib/project-workflow";
import type { ProjectStatus } from "#/lib/vocabularies";
import {
  hardDeleteProject,
  returnToDraft,
  submitProject,
} from "#/server/projects";
import { ConfirmDialog } from "./confirm-dialog";
import { SectionHeading } from "./section-heading";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

interface Project {
  id: string;
  status: string;
}

interface Props {
  onChanged: () => void;
  project: Project;
}

export function OwnerProjectActions({ project, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "submit" | "withdraw") {
    setError(null);
    setBusy(true);
    try {
      switch (action) {
        case "submit":
          await submitProject({ data: { id: project.id } });
          break;
        case "withdraw":
          await returnToDraft({ data: { id: project.id } });
          break;
        default:
          break;
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    setError(null);
    setBusy(true);
    try {
      await hardDeleteProject({ data: { id: project.id } });
      window.location.href = "/my/projects";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
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
  // The wire hands over a string; a value the vocabulary lacks gets no
  // sentence rather than a crash, the same fallback the badge takes.
  const status = project.status as ProjectStatus;
  const description = PROJECT_STATUS_DESCRIPTION[status] as string | undefined;

  // Rendered for every status, not only the ones with a button: the status
  // sentence is the one place the proposer is told what "approved" or
  // "submitted" means for them (#303), and those are exactly the statuses
  // with nothing to click.
  return (
    <Card asChild className="mt-6 bg-secondary p-4">
      <section>
        <SectionHeading>Your actions</SectionHeading>
        {description && (
          <p className="mt-2 text-muted-foreground text-sm">
            <span className="font-medium text-foreground">
              {PROJECT_STATUS_LABEL[status]}
            </span>
            : {description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {visible.map((b) => (
            <Button
              disabled={busy}
              key={b.id}
              onClick={() => void run(b.id)}
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
        {error && <p className="mt-3 text-destructive text-sm">{error}</p>}
      </section>
    </Card>
  );
}
