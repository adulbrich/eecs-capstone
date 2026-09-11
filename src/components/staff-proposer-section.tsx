import { useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { updateProjectProposer } from "#/server/projects";
import type { ProposerForEdit } from "#/server/projects-queries";
import { PanelSection } from "./panel";
import { ProposerPicker } from "./proposer-picker";
import { ProposerSummary } from "./proposer-summary";
import { Button } from "./ui/button";

/**
 * The staff edit of the proposer link, as a section of the staff panel (#322).
 * Link, reassign and unlink each take one Save and write one edit-log row
 * through `updateProjectProposer`, the only writer of the address after
 * create.
 *
 * The saved record is the panel's: the transition dialog reads the address
 * too, so the panel loads it once and reloads it after a save through
 * `onSaved`, rather than this section holding a second copy that could go
 * stale under the dialog. The draft is local. `ProposerPicker` snapshots the
 * saved address at mount to decide whether the field is locked, so the body
 * is keyed on that address: a save that changes it remounts the picker, which
 * re-locks it against the new link, and drops a draft that no longer applies.
 */
export function StaffProposerSection({
  onSaved,
  projectId,
  proposer,
}: {
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
        <p className="text-muted-foreground text-sm">Loading the proposer...</p>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingChange = email.trim() !== proposer.email;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProjectProposer({
        data: { id: projectId, proposerEmail: email.trim() },
      });
      await onSaved();
    } catch (e) {
      setError(errorMessage(e, "Save failed"));
    } finally {
      setBusy(false);
    }
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
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button
        // Nothing to save until the draft differs from the record, and no
        // save while one is in flight: a second click would race the reload.
        disabled={busy || !pendingChange}
        onClick={() => void save()}
        size="sm"
        type="button"
      >
        {busy ? "Saving..." : "Save proposer"}
      </Button>
    </div>
  );
}
