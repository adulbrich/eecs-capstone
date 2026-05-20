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

type Project = {
  id: string;
  status: string;
  deletedAt: Date | string | null;
  notes: string | null;
};

type EditLogRow = {
  id: string;
  editorId: string;
  changedFields: string[];
  oldValues: unknown;
  newValues: unknown;
  createdAt: Date | string;
};

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
        if (!confirm("Permanently delete this draft? This cannot be undone."))
          return;
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
    <div className="mt-8 rounded-lg border-2 border-[var(--brand-primary-tint)] bg-card p-4">
      <p className="island-kicker mb-3">Staff panel</p>

      {/* Status stepper — vertical on mobile, horizontal on md+ */}
      <div className="md:overflow-x-auto md:pb-1">
        <div className="flex flex-col md:flex-row md:min-w-max md:items-center">
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
                key={s}
                className="flex flex-col md:flex-row md:items-center"
              >
                {i > 0 && (
                  <>
                    {/* vertical track line (mobile) */}
                    <div
                      aria-hidden
                      className="ml-3.5 h-4 w-px flex-shrink-0 bg-border md:hidden"
                    />
                    {/* horizontal track line (desktop) */}
                    <div
                      aria-hidden
                      className="hidden h-px w-5 flex-shrink-0 bg-border md:block"
                    />
                  </>
                )}
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => {
                    if (isNormal) void transition(s);
                    else setPendingOverride(s);
                  }}
                  title={
                    isCurrent
                      ? "Current status"
                      : isNormal
                        ? `Move to ${STATUS_LABEL[s]}`
                        : `Override: force to ${STATUS_LABEL[s]}`
                  }
                  className={pillClass}
                >
                  {STATUS_LABEL[s]}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--brand-primary)]" />
          Current
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[var(--brand-primary)]" />
          Normal flow
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-border" />
          Override
        </span>
      </div>

      {/* Comment textarea */}
      <section className="mt-4 space-y-1.5">
        <label htmlFor="staff-comment" className="block text-sm font-medium">
          Comment (added to status history)
        </label>
        <Textarea
          id="staff-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional — explain the action"
          rows={2}
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
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void transition(pendingOverride, true)}
            >
              Confirm override
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPendingOverride(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {/* Danger zone */}
      <section className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Danger zone
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!project.deletedAt && project.status !== "draft" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runDelete("softDelete")}
            >
              Soft delete
            </Button>
          )}
          {project.deletedAt && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runDelete("restore")}
            >
              Restore
            </Button>
          )}
          {project.status === "draft" && !project.deletedAt && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void runDelete("hardDelete")}
            >
              Hard delete
            </Button>
          )}
        </div>
      </section>

      {/* Internal notes */}
      {project.notes && (
        <section className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Internal notes</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{project.notes}</p>
        </section>
      )}

      {/* Edit log */}
      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Edit log</h3>
        {editLog.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No edits yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {editLog.map((row) => (
              <li key={row.id} className="border-l-2 border-border pl-2">
                <div className="text-xs text-muted-foreground">
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
