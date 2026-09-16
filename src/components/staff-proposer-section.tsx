import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { updateProjectProposer } from "#/server/projects";
import type { ProposerForEdit } from "#/server/projects-queries";
import { PanelSection } from "./panel";
import { ProposerPicker } from "./proposer-picker";
import { ProposerSummary } from "./proposer-summary";
import { EMAIL_SKIP_HINT } from "./send-email-checkbox";
import { SendEmailDialog } from "./send-email-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";

/**
 * The staff edit of the proposer link, as a section of the staff panel (#322),
 * and of the student-proposed mark, which says who proposed the project and
 * so lives here rather than under Mentor (#336). Link, reassign, unlink and
 * the mark each take one Save and write one edit-log row through
 * `updateProjectProposer`, the only writer of the address after create.
 *
 * The saved record is the panel's: the transition dialog reads the address
 * too, so the panel loads it once and reloads it after a save through
 * `onSaved`, rather than this section holding a second copy that could go
 * stale under the dialog. The draft is local. `ProposerPicker` snapshots the
 * saved address at mount to decide whether the field is locked, so the body
 * is keyed on that address: a save that changes it remounts the picker, which
 * re-locks it against the new link, and drops a draft that no longer applies.
 * The checkbox draft rides on the same key: the two are saved together, so a
 * remount always lands on the value that was just saved.
 *
 * A save that changes the address to a new one emails it and writes the new
 * proposer's bell row, so that save goes through a confirm carrying the skip
 * (#379); the mark alone, the same address, or an unlink saves without one,
 * and the server mails nobody for those (#385).
 */
export function StaffProposerSection({
  loadError,
  onSaved,
  projectId,
  proposer,
}: {
  /** Why the panel's load failed, if it did; shown in place of the draft. */
  loadError: string | null;
  onSaved: () => Promise<void>;
  projectId: string;
  /** Null until the panel's load has answered. Save stays disabled until then. */
  proposer: ProposerForEdit | null;
}) {
  return (
    <PanelSection title="Proposer">
      {proposer ? (
        <ProposerDraft
          key={proposer.email}
          onSaved={onSaved}
          projectId={projectId}
          proposer={proposer}
        />
      ) : (
        <>
          <FieldError message={loadError} />
          {loadError ? null : (
            <p className="text-muted-foreground text-sm">
              Loading the proposer...
            </p>
          )}
        </>
      )}
    </PanelSection>
  );
}

function ProposerDraft({
  onSaved,
  projectId,
  proposer,
}: {
  onSaved: () => Promise<void>;
  projectId: string;
  proposer: ProposerForEdit;
}) {
  const [email, setEmail] = useState(proposer.email);
  const [studentProposed, setStudentProposed] = useState(
    proposer.studentProposed
  );
  // A second activation in the same tick would mail the proposer twice;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run } = useAction({ fallback: "Save failed" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const trimmed = email.trim();
  const pendingChange =
    trimmed !== proposer.email || studentProposed !== proposer.studentProposed;
  // Compared after lowercasing, as the server compares: a case-only retype
  // is not a change there and mails nobody.
  const announces = trimmed !== "" && trimmed.toLowerCase() !== proposer.email;

  function save(sendEmail: boolean) {
    return run(async () => {
      await updateProjectProposer({
        data: {
          id: projectId,
          proposerEmail: trimmed,
          sendEmail,
          studentProposed,
        },
      });
      setConfirmOpen(false);
      await onSaved();
    });
  }

  return (
    <div className="space-y-3">
      <ProposerSummary proposer={proposer} />
      <ProposerPicker
        accountLinked={proposer.accountLinked}
        accountName={proposer.accountName}
        onChange={setEmail}
        value={email}
      />
      <p className="text-muted-foreground text-xs">
        Saving a new address emails it.
      </p>
      <div className="space-y-1">
        <Label className="font-normal">
          <Checkbox
            checked={studentProposed}
            onCheckedChange={(checked) => setStudentProposed(checked === true)}
          />
          Student proposed
        </Label>
        <p className="text-muted-foreground text-xs">
          Shown as a badge on the card and project page.
        </p>
      </div>
      {!confirmOpen && <FieldError message={error} />}
      <Button
        // Nothing to save until the draft differs from the record, and no
        // save while one is in flight: a second click would race the reload.
        disabled={busy || !pendingChange}
        onClick={() => (announces ? setConfirmOpen(true) : void save(true))}
        size="sm"
        type="button"
      >
        {busy ? "Saving..." : "Save proposer"}
      </Button>
      <SendEmailDialog
        address={trimmed}
        busy={busy}
        confirmLabel="Save proposer"
        description={`This assigns the project to ${trimmed}.`}
        error={error}
        hint={EMAIL_SKIP_HINT.withBell}
        onConfirm={(sendEmail) => void save(sendEmail)}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title="Save the proposer?"
      />
    </div>
  );
}
