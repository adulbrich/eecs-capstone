import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { updateProjectProgram } from "#/server/projects";
import { PanelSection } from "./panel";
import { ProgramSelect } from "./program-select";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";

/**
 * The staff edit of `programId`, as a section of the staff panel (#450).
 * Placing a project in a program is staff judgement about how the course
 * runs, so the picker left the proposer's form and this is the only way to
 * set it after create; ADR-0026 records the trade.
 *
 * No load of its own, unlike the Mentor and Categories sections: the
 * program is already on the detail payload every viewer gets, so the draft
 * starts from the saved value rather than from blank. That also means there
 * is no window where a blank draft could be posted over a real value, which
 * is what those two sections disable Save to avoid.
 *
 * The draft is keyed on the saved value by the panel, which remounts on a
 * project change (`<StaffProjectPanel key={project.id}>`), so a navigation
 * between two projects cannot leave A's program in B's picker.
 */
export function StaffProgramSection({
  onChanged,
  programId,
  projectId,
}: {
  onChanged: () => Promise<void>;
  programId: string | null;
  projectId: string;
}) {
  const [draft, setDraft] = useState(programId ?? "");
  const { busy, error, run } = useAction({ fallback: "Save failed" });

  function save() {
    return run(async () => {
      await updateProjectProgram({ data: { id: projectId, programId: draft } });
      await onChanged();
    });
  }

  return (
    <PanelSection title="Program">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <ProgramSelect
            describedBy="staff-program-description"
            id="staff-program"
            onChange={setDraft}
            value={draft}
          />
          <p
            className="text-muted-foreground text-xs"
            id="staff-program-description"
          >
            The program this project runs in. Staff set it; the proposer cannot.
            Leave it empty for a project not yet placed.
          </p>
        </div>
        <FieldError message={error} />
        <Button
          disabled={busy}
          onClick={() => void save()}
          size="sm"
          type="button"
        >
          {busy ? "Saving..." : "Save program"}
        </Button>
      </div>
    </PanelSection>
  );
}
