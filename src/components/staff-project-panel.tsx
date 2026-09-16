import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { STAFF_PANEL_AUDIENCE_HINT } from "#/lib/private-notes";
import {
  canTransition,
  PROJECT_STATUS_DESCRIPTION,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES_IN_DISPLAY_ORDER,
} from "#/lib/project-workflow";
import { useAction } from "#/lib/use-action";
import type { ProjectStatus } from "#/lib/vocabularies";
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
import { ScopeAssessmentSection } from "./scope-assessment-section";
import { EMAIL_SKIP_HINT, SendEmailCheckbox } from "./send-email-checkbox";
import { StaffCategoriesSection } from "./staff-categories-section";
import { StaffMentorshipSection } from "./staff-mentorship-section";
import { StaffProposerSection } from "./staff-proposer-section";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const WORKFLOW = PROJECT_STATUSES_IN_DISPLAY_ORDER;

interface Project {
  deletedAt: Date | string | null;
  id: string;
  status: string;
}

/**
 * Only these three transitions email the proposer. Publishing is deliberately
 * silent, which is what the approval email promises.
 */
const PROPOSER_EMAIL_TARGETS: ReadonlySet<ProjectStatus> = new Set([
  "approved",
  "changes_requested",
  "draft",
]);

interface PendingTransition {
  force: boolean;
  target: ProjectStatus;
}

/**
 * Changes requested and a staff return to draft both email the proposer, and
 * a message with no reason tells them nothing, so the dialog holds Confirm
 * until one is typed. The force path is exempt on the server too.
 */
function commentRequired(pending: PendingTransition | null): boolean {
  return (
    pending?.target === "changes_requested" ||
    (pending?.target === "draft" && !pending.force)
  );
}

function emailsProposer(pending: PendingTransition | null): boolean {
  return pending !== null && PROPOSER_EMAIL_TARGETS.has(pending.target);
}

function dialogDescription(pending: PendingTransition | null): string {
  if (pending?.target === "changes_requested") {
    return "Tell the proposer what needs to change. A comment is required and they will be notified.";
  }
  if (pending?.target === "draft" && !pending.force) {
    return "Tell the proposer why this is going back to draft. A comment is required and they will be notified.";
  }
  if (pending?.force) {
    return "This overrides the workflow and bypasses the normal review process.";
  }
  return "Add a comment to record why you made this change.";
}

export function StaffProjectPanel({
  project,
  onChanged,
  viewerIsOwner,
}: {
  project: Project;
  onChanged: () => Promise<void>;
  /** Staff deleting their own draft: no email goes out, so no skip is offered. */
  viewerIsOwner: boolean;
}) {
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<PendingTransition | null>(null);
  // The ref inside the hook is the guard that matters: `disabled={busy}` alone
  // does not stop a second activation that arrives before React has
  // re-rendered, and a second transition writes a second history row and
  // mails again (#443).
  const { busy, error, run, setError } = useAction({
    fallback: "Transition failed",
  });
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);
  const [sendEmail, setSendEmail] = useState(true);
  const [deleteEmail, setDeleteEmail] = useState(true);
  // Null until loaded: the Proposer section keeps Save disabled until then.
  const [proposer, setProposer] = useState<ProposerForEdit | null>(null);
  const [proposerError, setProposerError] = useState<string | null>(null);
  // The dialog's checkbox has always keyed off "is there an address at all",
  // so it keeps reading exactly that rather than the whole record.
  const proposerAddress = proposer?.email || null;

  const loadEditLog = useCallback(async () => {
    try {
      const { rows } = await listProjectEditLog({
        data: { id: project.id },
      });
      setEditLog(rows as EditLogEntry[]);
    } catch {
      // ignored
    }
  }, [project.id]);

  const loadProposer = useCallback(async () => {
    try {
      setProposer(
        await getProposerForEdit({ data: { projectId: project.id } })
      );
      setProposerError(null);
    } catch (e) {
      // Reported in the Proposer section, where Save stays disabled, the way
      // the other sections report a failed load. The dialog degrades to "no
      // address on file" and sends nothing, which is the safe direction.
      setProposerError(errorMessage(e, "Could not load the proposer record"));
    }
  }, [project.id]);

  useEffect(() => {
    void loadEditLog();
  }, [loadEditLog]);

  useEffect(() => {
    void loadProposer();
  }, [loadProposer]);

  // A saved proposer has to reach the transition dialog's email checkbox
  // without a reload, and the edit log below it, so the section hands the
  // save back here rather than reloading a copy of its own.
  async function onProposerSaved() {
    await Promise.all([loadProposer(), loadEditLog()]);
    await onChanged();
  }

  // Same for the other writers in this panel: a save shows up in the log.
  async function onSectionChanged() {
    await loadEditLog();
    await onChanged();
  }

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

  function confirmTransition() {
    if (!pending) {
      return;
    }
    const target = pending;
    return run(async () => {
      const data = {
        id: project.id,
        status: target.target,
        comment,
        // Send the staff decision as-is. Do NOT also gate on whether the
        // proposer has an address: this flag mutes every email the transition
        // would send, including the review-inbox notice on `submitted`, which
        // has nothing to do with the proposer. Gating here silently dropped
        // that notice for address-less projects and during the address fetch.
        // The server already declines to mail a proposer it cannot resolve.
        sendEmail,
      };
      if (target.force) {
        await forceSetProjectStatus({ data });
      } else {
        await performTransition({ data });
      }
      await onChanged();
      closeModal();
    });
  }

  // Both branches run from a ConfirmDialog, which owns the flight and shows a
  // refusal inside itself (#410). Restore confirms too: it is as much a change
  // to what the public sees as the soft delete it undoes.
  async function runDelete(action: "softDelete" | "restore") {
    if (action === "softDelete") {
      await softDeleteProject({ data: { id: project.id } });
    } else {
      await restoreProject({ data: { id: project.id } });
    }
    await onChanged();
  }

  async function runHardDelete() {
    await hardDeleteProject({
      data: { id: project.id, sendEmail: deleteEmail },
    });
    window.location.href = "/admin/projects";
  }

  const needsComment = commentRequired(pending);
  const proposerEmailed = emailsProposer(pending);

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

      {/* Section order is the one #322 asked for: Status, Proposer,
          Mentorship, Scope assessment, Categories, Edit log, Danger zone. */}
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
                pillTitle = `Move to ${PROJECT_STATUS_LABEL[s]}`;
              } else {
                pillState =
                  "cursor-pointer border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground";
                pillTitle = `Override: force to ${PROJECT_STATUS_LABEL[s]}`;
              }
              // The action first, then what the status means (#303). Tests
              // match the pill by the action with `/^Move to Approved\./`,
              // since `getByTitle` with a string is an exact match.
              const pillTooltip = `${pillTitle}. ${PROJECT_STATUS_DESCRIPTION[s]}`;
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
                    title={pillTooltip}
                    type="button"
                  >
                    {PROJECT_STATUS_LABEL[s]}
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
        {/*
          The current status in words, for the reader who does not hover a
          pill. Same record the pill tooltips read.
        */}
        <p className="mt-2 text-muted-foreground text-xs">
          <span className="font-medium text-foreground">
            {PROJECT_STATUS_LABEL[currentStatus]}
          </span>
          : {PROJECT_STATUS_DESCRIPTION[currentStatus]}
        </p>
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
              {pending ? PROJECT_STATUS_LABEL[pending.target] : ""}
            </DialogTitle>
            <DialogDescription>{dialogDescription(pending)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="staff-comment">
              {needsComment
                ? "What needs to change? (required)"
                : "Comment (optional)"}
            </Label>
            <Textarea
              id="staff-comment"
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                needsComment
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
          {proposerEmailed && (
            <SendEmailCheckbox
              address={proposerAddress}
              checked={sendEmail}
              hint={EMAIL_SKIP_HINT.withBell}
              onCheckedChange={setSendEmail}
            />
          )}
          <FieldError message={error} />
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={closeModal}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || (needsComment && !comment.trim())}
              onClick={() => void confirmTransition()}
              type="button"
              variant={pending?.force ? "destructive" : "default"}
            >
              {busy ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!pending && <FieldError message={error} />}

      <StaffProposerSection
        loadError={proposerError}
        onSaved={onProposerSaved}
        projectId={project.id}
        proposer={proposer}
      />

      <StaffMentorshipSection
        onChanged={onSectionChanged}
        projectId={project.id}
      />

      {/* Private notes render on the shared project page, above this panel:
          they are visible to the proposer as well, so they are not staff-only
          content and would be duplicated here. */}

      {/* Only staff: the verdict never enters the project payload, so it is
          loaded here by a staff-gated read (#61). */}
      <PanelSection title="Scope assessment">
        <ScopeAssessmentSection projectId={project.id} />
      </PanelSection>

      <StaffCategoriesSection
        onChanged={onSectionChanged}
        projectId={project.id}
      />

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
              <Button size="sm" type="button" variant="outline">
                Soft delete
              </Button>
            </ConfirmDialog>
          )}
          {project.deletedAt && (
            <ConfirmDialog
              busyLabel="Restoring..."
              confirmLabel="Restore"
              description="The project returns to the listings at the status it held before it was deleted."
              onConfirm={() => runDelete("restore")}
              title="Restore this project?"
            >
              <Button size="sm" type="button" variant="outline">
                Restore
              </Button>
            </ConfirmDialog>
          )}
          {project.status === "draft" && !project.deletedAt && (
            <ConfirmDialog
              body={
                // The proposer's only channel, since the row their bell would
                // link to is about to go: staff can still skip it (#379).
                !viewerIsOwner && (
                  <SendEmailCheckbox
                    address={proposerAddress}
                    checked={deleteEmail}
                    hint={EMAIL_SKIP_HINT.emailOnly}
                    onCheckedChange={setDeleteEmail}
                  />
                )
              }
              confirmLabel="Hard delete"
              description="This cannot be undone."
              onConfirm={runHardDelete}
              title="Permanently delete this draft?"
            >
              <Button
                // Checked again each time the confirm opens, as the ban
                // form does: a Cancel must not carry an unchecked box over.
                onClick={() => setDeleteEmail(true)}
                size="sm"
                type="button"
                variant="destructive"
              >
                Hard delete
              </Button>
            </ConfirmDialog>
          )}
        </div>
      </PanelSection>
    </Panel>
  );
}
