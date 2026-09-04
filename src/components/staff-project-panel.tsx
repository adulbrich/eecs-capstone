import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { STAFF_PANEL_AUDIENCE_HINT } from "#/lib/private-notes";
import { canTransition } from "#/lib/project-workflow";
import { PROJECT_STATUSES, type ProjectStatus } from "#/lib/vocabularies";
import {
  forceSetProjectStatus,
  hardDeleteProject,
  performTransition,
  restoreProject,
  softDeleteProject,
} from "#/server/projects";
import {
  getProposerForEdit,
  listProjectEditLog,
  type ProposerForEdit,
} from "#/server/projects-queries";
import { ConfirmDialog } from "./confirm-dialog";
import { type EditLogEntry, EditLogList } from "./edit-log-list";
import { Panel, PanelHeader, PanelNote, PanelSection } from "./panel";
import { ProposerSummary } from "./proposer-summary";
import { ScopeAssessmentSection } from "./scope-assessment-section";
import { StaffMentorshipSection } from "./staff-mentorship-section";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * The stepper's order, which is not the vocabulary's: this reads
 * `changes_requested` as the step back out of `submitted` and draws it beside
 * it, where the tuple lists the two outcomes of a review the other way round.
 * The order lives in a `Record` keyed by the union, so a status added to the
 * vocabulary and not ranked here fails to compile rather than quietly going
 * missing from the stepper.
 */
const WORKFLOW_RANK: Record<ProjectStatus, number> = {
  draft: 0,
  submitted: 1,
  changes_requested: 2,
  approved: 3,
  published: 4,
  archived: 5,
};

const WORKFLOW: readonly ProjectStatus[] = [...PROJECT_STATUSES].sort(
  (a, b) => WORKFLOW_RANK[a] - WORKFLOW_RANK[b]
);

const STATUS_LABEL: Record<ProjectStatus, string> = {
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
  status: string;
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
  const [pending, setPending] = useState<{
    target: ProjectStatus;
    force: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);
  const [sendEmail, setSendEmail] = useState(true);
  const [proposer, setProposer] = useState<ProposerForEdit>({
    accountLinked: false,
    accountName: null,
    email: "",
  });
  // The dialog's checkbox has always keyed off "is there an address at all",
  // so it keeps reading exactly that rather than the whole record.
  const proposerAddress = proposer.email || null;

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listProjectEditLog({
          data: { id: project.id },
        });
        setEditLog(rows as EditLogEntry[]);
      } catch {
        // ignored
      }
    })();
  }, [project.id]);

  useEffect(() => {
    void (async () => {
      try {
        setProposer(
          await getProposerForEdit({ data: { projectId: project.id } })
        );
      } catch {
        // Staff-only endpoint; on failure the dialog degrades to "no address
        // on file" and sends nothing, which is the safe direction.
      }
    })();
  }, [project.id]);

  const currentStatus = project.status as ProjectStatus;

  function openTransition(target: ProjectStatus, force: boolean) {
    setError(null);
    setComment("");
    setSendEmail(true);
    setPending({ target, force });
  }

  function closeModal() {
    setPending(null);
    setComment("");
  }

  async function confirmTransition() {
    if (!pending) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const data = {
        id: project.id,
        status: pending.target,
        comment,
        // Send the staff decision as-is. Do NOT also gate on whether the
        // proposer has an address: this flag mutes every email the transition
        // would send, including the review-inbox notice on `submitted`, which
        // has nothing to do with the proposer. Gating here silently dropped
        // that notice for address-less projects and during the address fetch.
        // The server already declines to mail a proposer it cannot resolve.
        sendEmail,
      };
      if (pending.force) {
        await forceSetProjectStatus({ data });
      } else {
        await performTransition({ data });
      }
      closeModal();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runDelete(action: "softDelete" | "restore") {
    setError(null);
    try {
      if (action === "softDelete") {
        await softDeleteProject({ data: { id: project.id } });
      } else {
        await restoreProject({ data: { id: project.id } });
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runHardDelete() {
    setError(null);
    try {
      await hardDeleteProject({ data: { id: project.id } });
      window.location.href = "/admin/projects";
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const isChangesRequested = pending?.target === "changes_requested";

  // Only these two transitions email anyone. Publishing is deliberately silent,
  // which is what the approval email promises.
  const emailsProposer =
    pending?.target === "approved" || pending?.target === "changes_requested";

  return (
    <Panel tone="staff">
      <PanelHeader
        actions={
          // Mirrors "Manage inventory" on the item page: this page is reachable
          // publicly, so staff who came from the management table need a way
          // back to it.
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/projects">Manage projects</Link>
          </Button>
        }
        title="Staff panel"
      />
      <PanelNote>{STAFF_PANEL_AUDIENCE_HINT}</PanelNote>

      <PanelSection title="Proposer">
        <ProposerSummary proposer={proposer} />
      </PanelSection>

      <StaffMentorshipSection onChanged={onChanged} projectId={project.id} />

      <PanelSection title="Status">
        {/* Status stepper: vertical on mobile, horizontal on md+ */}
        <div className="md:overflow-x-auto md:pb-1">
          <div className="flex flex-col md:min-w-max md:flex-row md:items-center">
            {WORKFLOW.map((s, i) => {
              const isCurrent = s === currentStatus;
              const isNormal =
                !isCurrent && canTransition(currentStatus, s, "staff");

              let pillState: string;
              let pillTitle: string;
              if (isCurrent) {
                // The semantic pair, not the decorative brand token: in dark
                // mode --primary is pinned darker so white clears 4.5:1 on it,
                // and white on --brand-primary measures 3.48 there.
                pillState = "cursor-default bg-primary text-primary-foreground";
                pillTitle = "Current status";
              } else if (isNormal) {
                // Text in the dark/light-inverted shade, as the island kicker
                // in styles.css explains: the vivid orange scrapes past on the
                // card at rest (4.56 light, 4.90 dark) and drops under 4.5 on
                // the tinted hover background in both modes. The border is
                // decorative and keeps the vivid orange. The tint has no
                // Tailwind alias, so it stays a var().
                pillState =
                  "cursor-pointer border-2 border-brand text-brand-dark hover:bg-[var(--brand-primary-tint)]";
                pillTitle = `Move to ${STATUS_LABEL[s]}`;
              } else {
                pillState =
                  "cursor-pointer border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground";
                pillTitle = `Override: force to ${STATUS_LABEL[s]}`;
              }
              const pillClass = [
                "rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                pillState,
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
                    onClick={() => openTransition(s, !isNormal)}
                    title={pillTitle}
                    type="button"
                  >
                    {STATUS_LABEL[s]}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-muted-foreground text-xs">
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
      </PanelSection>

      {/* Status-change confirmation modal (normal + override) */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            closeModal();
          }
        }}
        open={pending !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.force ? "Override to " : "Move to "}
              {pending ? STATUS_LABEL[pending.target] : ""}
            </DialogTitle>
            <DialogDescription>
              {(() => {
                if (isChangesRequested) {
                  return "Tell the proposer what needs to change. A comment is required and they will be notified.";
                }
                if (pending?.force) {
                  return "This overrides the workflow and bypasses the normal review process.";
                }
                return "Add a comment to record why you made this change.";
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="staff-comment">
              {isChangesRequested
                ? "What needs to change? (required)"
                : "Comment (optional)"}
            </Label>
            <Textarea
              id="staff-comment"
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                isChangesRequested
                  ? "Describe what the proposer needs to change"
                  : "Explain the action"
              }
              rows={3}
              value={comment}
            />
            <p className="text-muted-foreground text-xs">
              The project proposer can see this comment.
            </p>
          </div>
          {emailsProposer && (
            <div className="space-y-1">
              <Label className="font-normal">
                <Checkbox
                  checked={sendEmail && proposerAddress !== null}
                  disabled={proposerAddress === null}
                  onCheckedChange={(checked) => setSendEmail(checked === true)}
                />
                {proposerAddress
                  ? `Email the proposer (${proposerAddress})`
                  : "No address on file, no email will be sent"}
              </Label>
              {proposerAddress && (
                <p className="text-muted-foreground text-xs">
                  Uncheck to change the status silently.
                </p>
              )}
            </div>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={closeModal}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || (isChangesRequested && !comment.trim())}
              onClick={() => void confirmTransition()}
              type="button"
              variant={pending?.force ? "destructive" : "default"}
            >
              {busy ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && !pending && (
        <p className="mt-2 text-destructive text-sm">{error}</p>
      )}

      {/* Private notes render on the shared project page, above this panel:
          they are visible to the proposer as well, so they are not staff-only
          content and would be duplicated here. */}

      {/* Only staff: the verdict never enters the project payload, so it is
          loaded here by a staff-gated read (#61). */}
      <PanelSection title="Scope assessment">
        <ScopeAssessmentSection projectId={project.id} />
      </PanelSection>

      <PanelSection title="Edit log">
        <EditLogList rows={editLog} />
      </PanelSection>

      {/* Last, as on the item page: the irreversible actions sit at the far
          end of the panel rather than between two things staff read. */}
      <PanelSection title="Danger zone" tone="danger">
        <div className="flex flex-wrap gap-2">
          {!project.deletedAt && project.status !== "draft" && (
            <ConfirmDialog
              confirmLabel="Soft delete"
              description="The project is hidden from listings. Staff can restore it from this panel afterwards."
              onConfirm={() => runDelete("softDelete")}
              title="Soft delete this project?"
            >
              <Button size="sm" variant="outline">
                Soft delete
              </Button>
            </ConfirmDialog>
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
            <ConfirmDialog
              confirmLabel="Hard delete"
              description="This cannot be undone."
              onConfirm={runHardDelete}
              title="Permanently delete this draft?"
            >
              <Button size="sm" variant="destructive">
                Hard delete
              </Button>
            </ConfirmDialog>
          )}
        </div>
      </PanelSection>
    </Panel>
  );
}
