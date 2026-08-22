import { useState } from "react";
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
  if (visible.length === 0 && !error) {
    return null;
  }

  return (
    <Card asChild className="mt-6 bg-secondary p-4">
      <section>
        <SectionHeading>Your actions</SectionHeading>
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
              <Button disabled={busy} size="sm" variant="destructive">
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
