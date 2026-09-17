import { useEffect, useState } from "react";
import { listPrograms } from "#/server/programs";
import { Checkbox } from "./ui/checkbox";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";

interface Program {
  courseId: string;
  courseName: string;
  id: string;
}

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
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listPrograms();
        setPrograms(rows as Program[]);
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
    <div aria-describedby={describedBy} className="space-y-2">
      <FieldError message={loadError} />
      {!loadError && programs.length === 0 && (
        <p className="text-muted-foreground text-sm">No programs yet.</p>
      )}
      {programs.length > 0 && (
        <fieldset className="border border-border p-2">
          <legend className="px-1 font-medium text-muted-foreground text-xs">
            Programs
          </legend>
          <div className="flex flex-wrap gap-2">
            {programs.map((p) => (
              <Label className="font-normal" key={p.id}>
                <Checkbox
                  checked={value.includes(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                />
                {p.courseId} {p.courseName}
              </Label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
