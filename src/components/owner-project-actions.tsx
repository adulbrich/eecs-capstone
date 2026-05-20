import { useState } from "react";
import {
  hardDeleteProject,
  returnToDraft,
  submitProject,
} from "#/server/projects";

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
    primary?: boolean;
    destructive?: boolean;
  }> = [
    {
      id: "submit",
      label:
        project.status === "changes_requested"
          ? "Resubmit for review"
          : "Submit for review",
      show:
        project.status === "draft" || project.status === "changes_requested",
      primary: true,
    },
    {
      id: "withdraw",
      label: "Withdraw to draft",
      show: project.status === "submitted",
    },
    {
      id: "delete",
      label: "Delete draft",
      show: project.status === "draft",
      destructive: true,
    },
  ];

  const visible = buttons.filter((b) => b.show);
  if (visible.length === 0 && !error) return null;

  return (
    <section className="mt-6 border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="font-medium text-sm">Your actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {visible.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={busy}
            onClick={() => void run(b.id)}
            className={
              b.primary
                ? "bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
                : b.destructive
                  ? "border border-red-300 px-3 py-1.5 text-red-700 text-sm hover:bg-red-50 disabled:opacity-50"
                  : "border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
            }
          >
            {b.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}
    </section>
  );
}
