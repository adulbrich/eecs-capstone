import { Minus, Plus } from "lucide-react";
import { useId, useState } from "react";
import { NumberInput } from "#/components/placement/number-input";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import {
  PARAMETER_LIMITS,
  type Workspace,
  type WorkspaceParameters,
} from "#/lib/placement/workspace";

const MAX_PRIORITIES = 20;

export function ParametersTab({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const { parameters } = workspace;
  const [sizeError, setSizeError] = useState<string | null>(null);
  const set = (patch: Partial<WorkspaceParameters>) =>
    state.update((w) => ({ ...w, parameters: { ...w.parameters, ...patch } }));
  // A saved workspace with min above max would fail its own schema on the
  // next load, so the pair is only written when it holds.
  const setSize = (field: "minStudents" | "maxStudents", value: number) => {
    const next = { ...parameters, [field]: value };
    if (next.minStudents > next.maxStudents) {
      setSizeError(
        "Min students per team must not be above max students per team."
      );
      return;
    }
    setSizeError(null);
    set({ [field]: value });
  };
  const weights = parameters.rankWeights;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section aria-labelledby="placement-defaults-heading">
        <h2 className="font-medium" id="placement-defaults-heading">
          Defaults for every project
        </h2>
        <p className="text-muted-foreground text-sm">
          A project's own value on the Projects tab wins over these. Team size
          counts each team: a project allowed 2 teams of at most 4 students
          takes up to 8.
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          <Field label="Min students per team">
            <NumberInput
              label="Min students per team"
              max={PARAMETER_LIMITS.students.max}
              min={PARAMETER_LIMITS.students.min}
              onCommit={(v) => v !== undefined && setSize("minStudents", v)}
              value={parameters.minStudents}
            />
          </Field>
          <Field label="Max students per team">
            <NumberInput
              label="Max students per team"
              max={PARAMETER_LIMITS.students.max}
              min={PARAMETER_LIMITS.students.min}
              onCommit={(v) => v !== undefined && setSize("maxStudents", v)}
              value={parameters.maxStudents}
            />
          </Field>
          <Field label="Max teams per project">
            <NumberInput
              label="Max teams per project"
              max={PARAMETER_LIMITS.maxTeams.max}
              min={PARAMETER_LIMITS.maxTeams.min}
              onCommit={(v) => v !== undefined && set({ maxTeams: v })}
              value={parameters.maxTeams}
            />
          </Field>
        </div>
        <FieldError message={sizeError} />
      </section>

      <section aria-labelledby="placement-weights-heading">
        <h2 className="font-medium" id="placement-weights-heading">
          Weight of each priority
        </h2>
        <p className="text-muted-foreground text-sm">
          The solver favours the placement with the highest total weight. A
          priority past the last one here weighs 0.
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          {weights.map((weight, index) => (
            <Field
              // Positional on purpose: the list only grows and shrinks at
              // its end, so an index names the same priority throughout.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              label={`Priority ${index + 1}`}
            >
              <NumberInput
                integer={false}
                label={`Weight of priority ${index + 1}`}
                max={PARAMETER_LIMITS.weight.max}
                min={PARAMETER_LIMITS.weight.min}
                onCommit={(v) =>
                  v !== undefined &&
                  set({
                    rankWeights: weights.map((w, i) => (i === index ? v : w)),
                  })
                }
                value={weight}
              />
            </Field>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            disabled={weights.length >= MAX_PRIORITIES}
            onClick={() => set({ rankWeights: [...weights, 0] })}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" />
            Add a priority
          </Button>
          <Button
            disabled={weights.length === 0}
            onClick={() => set({ rankWeights: weights.slice(0, -1) })}
            size="sm"
            type="button"
            variant="outline"
          >
            <Minus aria-hidden="true" />
            Remove the last
          </Button>
        </div>
      </section>

      <section aria-labelledby="placement-rules-heading">
        <h2 className="font-medium" id="placement-rules-heading">
          Rules
        </h2>
        <div className="mt-2 flex flex-col gap-3">
          <Toggle
            checked={parameters.requireOneTeamPerProject}
            description="A project enough students bid on forms at least one team, even when the students would score higher elsewhere."
            label="At least one team per project"
            onChange={(v) => set({ requireOneTeamPerProject: v })}
          />
          <Toggle
            checked={parameters.allowUnranked}
            description="Lets the solver place a student on a project they did not bid on, at weight 0, rather than leave them unplaced."
            label="Allow projects a student did not bid on"
            onChange={(v) => set({ allowUnranked: v })}
          />
          <Field label="Time limit (seconds)">
            <NumberInput
              label="Time limit in seconds"
              max={PARAMETER_LIMITS.timeLimitSeconds.max}
              min={PARAMETER_LIMITS.timeLimitSeconds.min}
              onCommit={(v) => v !== undefined && set({ timeLimitSeconds: v })}
              value={parameters.timeLimitSeconds}
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

/** A visible label over a control that carries its own accessible name. */
function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden="true" className="text-sm">
        {label}
      </span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        aria-describedby={`${id}-description`}
        checked={checked}
        id={id}
        onCheckedChange={onChange}
      />
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-sm" id={`${id}-description`}>
          {description}
        </p>
      </div>
    </div>
  );
}
