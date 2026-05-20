import { useState } from "react";
import {
  hardDeleteProject,
  returnToDraft,
  submitProject,
} from "#/server/projects";
import { Button } from "./ui/button";

type Project = {
  id: string;
  status: string;
};

type Props = {
  project: Project;
  onChanged: () => void;
};

export function OwnerProjectActions({ project, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "submit" | "withdraw" | "delete") {
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
        case "delete":
          if (
            !confirm("Permanently delete this draft? This cannot be undone.")
          ) {
            setBusy(false);
            return;
          }
          await hardDeleteProject({ data: { id: project.id } });
          window.location.href = "/my/projects";
          return;
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const buttons: Array<{
    id: "submit" | "withdraw" | "delete";
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
    {
      id: "delete",
      label: "Delete draft",
      show: project.status === "draft",
      variant: "destructive",
    },
  ];

  const visible = buttons.filter((b) => b.show);
  if (visible.length === 0 && !error) return null;

  return (
    <section className="mt-6 rounded-lg border border-border bg-secondary p-4">
      <h2 className="font-medium text-sm">Your actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {visible.map((b) => (
          <Button
            key={b.id}
            type="button"
            variant={b.variant ?? "outline"}
            size="sm"
            disabled={busy}
            onClick={() => void run(b.id)}
          >
            {b.label}
          </Button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
