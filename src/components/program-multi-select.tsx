import { useEffect, useState } from "react";
import { type ProjectProgram, programLabel } from "#/lib/project-visibility";
import { listPrograms } from "#/server/programs";
import { Checkbox } from "./ui/checkbox";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";

interface Props {
  /** Id of the helper text describing this control, for aria-describedby. */
  describedBy?: string;
  onChange: (next: string[]) => void;
  value: string[];
}

/**
 * The programs a project runs in, as a checkbox list (#462).
 *
 * A checkbox list rather than a multi-select combobox, and modelled on
 * `CategoryMultiSelect` for that reason: programs are an admin-managed list
 * of a handful of courses, so every option fits on screen and a combobox
 * would add a search affordance over five items.
 *
 * It also retires the `_none_` sentinel `ProgramSelect` needs, because
 * unchecking everything is the cleared set and no value has to stand in for
 * the absence of one. `ProgramSelect` itself stays: the listing filters are
 * still single-valued.
 *
 * The last-good list survives a failed load, the same reason
 * `CategoryMultiSelect` keeps its own: `value` still references those ids
 * and Save will still write them.
 */
export function ProgramMultiSelect({ describedBy, value, onChange }: Props) {
  const [programs, setPrograms] = useState<ProjectProgram[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listPrograms();
        setPrograms(rows as ProjectProgram[]);
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Could not load programs"
        );
      }
    })();
  }, []);

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  }

  return (
    <div className="space-y-2">
      <FieldError message={loadError} />
      {!loadError && programs.length === 0 && (
        <p className="text-muted-foreground text-sm">No programs yet.</p>
      )}
      {programs.length > 0 && (
        // `aria-describedby` goes on the fieldset, not the wrapper: a bare
        // div has no role, so the description would never be announced.
        <fieldset
          aria-describedby={describedBy}
          className="border border-border p-2"
        >
          {/*
            Named for assistive tech but not drawn: the panel section above
            is already headed "Programs", and a visible legend repeats the
            word directly under it. `CategoryMultiSelect` shows its legend
            because there the text is the category type, which is new
            information.
          */}
          <legend className="sr-only">Programs</legend>
          <div className="flex flex-wrap gap-2">
            {programs.map((p) => (
              <Label className="font-normal" key={p.id}>
                <Checkbox
                  checked={value.includes(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                />
                {programLabel(p)}
              </Label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
