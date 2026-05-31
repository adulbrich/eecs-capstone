import { useEffect, useState } from "react";
import { canTransition, type Status } from "#/lib/project-workflow";
import {
  forceSetProjectStatus,
  hardDeleteProject,
  performTransition,
  restoreProject,
  softDeleteProject,
} from "#/server/projects";
import { listProjectEditLog } from "#/server/projects-queries";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const WORKFLOW: readonly Status[] = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "published",
  "archived",
];

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  submitted: "Submitted",
  changes_requested: "Changes Req.",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

interface Project {
  deletedAt: Date | string | null;
  id: string;
  notes: string | null;
  status: string;
}

interface EditLogRow {
  changedFields: string[];
  createdAt: Date | string;
  editorId: string;
  id: string;
  newValues: unknown;
  oldValues: unknown;
}

export function StaffProjectPanel({
  project,
  onChanged,
}: {
  project: Project;
  onChanged: () => void;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingOverride, setPendingOverride] = useState<Status | null>(null);
  const [editLog, setEditLog] = useState<EditLogRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listProjectEditLog({
          data: { id: project.id },
        });
        setEditLog(rows as EditLogRow[]);
      } catch {
        // ignored
      }
    })();
  }, [project.id]);

  const currentStatus = project.status as Status;

  async function transition(target: Status, force = false) {
    setError(null);
    try {
      if (force) {
        await forceSetProjectStatus({
          data: { id: project.id, status: target, comment },
        });
      } else {
        await performTransition({
          data: { id: project.id, status: target, comment },
        });
      }
      setComment("");
      setPendingOverride(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runDelete(action: "softDelete" | "restore" | "hardDelete") {
    setError(null);
    try {
      if (action === "softDelete") {
        await softDeleteProject({ data: { id: project.id } });
      } else if (action === "restore") {
        await restoreProject({ data: { id: project.id } });
      } else {
        if (!confirm("Permanently delete this draft? This cannot be undone.")) {
          return;
        }
        await hardDeleteProject({ data: { id: project.id } });
        window.location.href = "/admin/projects";
        return;
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mt-8 rounded-lg border-(--brand-primary-tint) border-2 bg-card p-4">
      <p className="island-kicker mb-3">Staff panel</p>

      {/* Status stepper — vertical on mobile, horizontal on md+ */}
      <div className="md:overflow-x-auto md:pb-1">
        <div className="flex flex-col md:min-w-max md:flex-row md:items-center">
          {WORKFLOW.map((s, i) => {
            const isCurrent = s === currentStatus;
            const isNormal =
              !isCurrent && canTransition(currentStatus, s, "staff");

            const pillClass = [
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              isCurrent
                ? "cursor-default bg-[var(--brand-primary)] text-white"
                : isNormal
                  ? "cursor-pointer border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] hover:bg-[var(--brand-primary-tint)]"
                  : "cursor-pointer border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground",
            ].join(" ");

            return (
              // flex-col on mobile stacks connector above pill; flex-row on desktop puts them side-by-side
              <div
                className="flex flex-col md:flex-row md:items-center"
                key={s}
              >
                {i > 0 && (
                  <>
                    {/* vertical track line (mobile) */}
                    <div
                      aria-hidden
                      className="ml-3.5 h-4 w-px shrink-0 bg-border md:hidden"
                    />
                    {/* horizontal track line (desktop) */}
                    <div
                      aria-hidden
                      className="hidden h-px w-5 shrink-0 bg-border md:block"
                    />
                  </>
                )}
                <button
                  className={pillClass}
                  disabled={isCurrent}
                  onClick={() => {
                    if (isNormal) {
                      void transition(s);
                    } else {
                      setPendingOverride(s);
                    }
                  }}
                  title={
                    isCurrent
                      ? "Current status"
                      : isNormal
                        ? `Move to ${STATUS_LABEL[s]}`
                        : `Override: force to ${STATUS_LABEL[s]}`
                  }
                  type="button"
                >
                  {STATUS_LABEL[s]}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand" />
          Current
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-brand" />
          Normal flow
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-border border-dashed" />
          Override
        </span>
      </div>

      {/* Comment textarea */}
      <section className="mt-4 space-y-1.5">
        <label className="block font-medium text-sm" htmlFor="staff-comment">
          Comment (added to status history)
        </label>
        <Textarea
          id="staff-comment"
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional — explain the action"
          rows={2}
          value={comment}
        />
      </section>

      {/* Override confirmation */}
      {pendingOverride && (
        <div className="mt-3 rounded-md border border-border bg-secondary p-3 text-sm">
          <p>
            Override workflow: force status to{" "}
            <strong>{STATUS_LABEL[pendingOverride]}</strong>? This bypasses the
            normal review process.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => void transition(pendingOverride, true)}
              size="sm"
              type="button"
              variant="destructive"
            >
              Confirm override
            </Button>
            <Button
              onClick={() => setPendingOverride(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-destructive text-sm">{error}</p>}

      {/* Danger zone */}
      <section className="mt-5 border-border border-t pt-4">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Danger zone
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!project.deletedAt && project.status !== "draft" && (
            <Button
              onClick={() => void runDelete("softDelete")}
              size="sm"
              type="button"
              variant="outline"
            >
              Soft delete
            </Button>
          )}
          {project.deletedAt && (
            <Button
              onClick={() => void runDelete("restore")}
              size="sm"
              type="button"
              variant="outline"
            >
              Restore
            </Button>
          )}
          {project.status === "draft" && !project.deletedAt && (
            <Button
              onClick={() => void runDelete("hardDelete")}
              size="sm"
              type="button"
              variant="destructive"
            >
              Hard delete
            </Button>
          )}
        </div>
      </section>

      {/* Internal notes */}
      {project.notes && (
        <section className="mt-5 border-border border-t pt-4">
          <h3 className="font-medium text-sm">Internal notes</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{project.notes}</p>
        </section>
      )}

      {/* Edit log */}
      <section className="mt-5 border-border border-t pt-4">
        <h3 className="font-medium text-sm">Edit log</h3>
        {editLog.length === 0 ? (
          <p className="mt-1 text-muted-foreground text-sm">No edits yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {editLog.map((row) => (
              <li className="border-border border-l-2 pl-2" key={row.id}>
                <div className="text-muted-foreground text-xs">
                  {row.editorId.slice(0, 8)} at{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </div>
                <div className="text-xs">
                  Changed: {row.changedFields.join(", ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
