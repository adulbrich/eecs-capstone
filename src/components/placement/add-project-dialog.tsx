import { Plus } from "lucide-react";
import { useId, useState } from "react";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  addProject,
  PARAMETER_LIMITS,
  type Workspace,
} from "#/lib/placement/workspace";

const EMPTY = {
  title: "",
  maxTeams: "",
  minStudents: "",
  maxStudents: "",
  studentProposed: false,
  proposerName: "",
  proposerEmail: "",
  mentorName: "",
  mentorEmail: "",
};

type Draft = typeof EMPTY;

/** Blank is the page default; anything else a whole number in range. */
function parseLimit(
  value: string,
  limits: { max: number; min: number }
): number | undefined | "invalid" {
  if (value.trim() === "") {
    return;
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= limits.min && n <= limits.max
    ? n
    : "invalid";
}

const text = (value: string) => value.trim() || undefined;

/**
 * One project added by hand (#716), for a project no program or file has,
 * or to build a short list without either. Plain state rather than a form
 * library, as the other dialogs here are: nine fields, checked on submit.
 */
export function AddProjectDialog({
  update,
  workspace,
}: {
  update: PlacementWorkspace["update"];
  workspace: Workspace;
}) {
  const { parameters } = workspace;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setError(null);
    };

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setDraft(EMPTY);
      setError(null);
    }
  }

  function submit() {
    const title = draft.title.replace(/\s+/g, " ").trim();
    if (title === "") {
      setError("Enter a title.");
      return;
    }
    const maxTeams = parseLimit(draft.maxTeams, PARAMETER_LIMITS.maxTeams);
    const minStudents = parseLimit(
      draft.minStudents,
      PARAMETER_LIMITS.students
    );
    const maxStudents = parseLimit(
      draft.maxStudents,
      PARAMETER_LIMITS.students
    );
    if (maxTeams === "invalid") {
      setError(
        `Max teams must be a whole number from ${PARAMETER_LIMITS.maxTeams.min} to ${PARAMETER_LIMITS.maxTeams.max}, or blank.`
      );
      return;
    }
    if (minStudents === "invalid" || maxStudents === "invalid") {
      setError(
        `Students per team must be whole numbers from ${PARAMETER_LIMITS.students.min} to ${PARAMETER_LIMITS.students.max}, or blank.`
      );
      return;
    }
    if (
      (minStudents ?? parameters.minStudents) >
      (maxStudents ?? parameters.maxStudents)
    ) {
      setError("Min students per team is above max students per team.");
      return;
    }
    const project = {
      title,
      maxTeams,
      minStudents,
      maxStudents,
      weightMultiplier: 1,
      studentProposed: draft.studentProposed || undefined,
      proposerName: text(draft.proposerName),
      proposerEmail: text(draft.proposerEmail),
      mentorName: text(draft.mentorName),
      mentorEmail: text(draft.mentorEmail),
    };
    // Checked against the workspace on screen for the message, then applied
    // to the one current at the write, so nothing saved since is lost.
    const checked = addProject(workspace, project);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    update((w) => {
      const added = addProject(w, project);
      return added.ok ? added.workspace : w;
    });
    onOpenChange(false);
  }

  const field = (
    key: Exclude<keyof Draft, "studentProposed">,
    label: string,
    props: React.ComponentProps<typeof Input> = {}
  ) => (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        autoComplete="off"
        id={`${id}-${key}`}
        onChange={(e) => set(key)(e.target.value)}
        value={draft[key]}
        {...props}
      />
    </div>
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <Plus aria-hidden="true" />
          Add project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a project</DialogTitle>
            <DialogDescription>
              For a project no program or file lists. Blank numbers use the
              defaults on the Parameters tab. Bids name it by this title.
            </DialogDescription>
          </DialogHeader>
          {field("title", "Title", { required: true })}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {field("maxTeams", "Max teams", {
              inputMode: "numeric",
              placeholder: String(parameters.maxTeams),
            })}
            {field("minStudents", "Min students", {
              inputMode: "numeric",
              placeholder: String(parameters.minStudents),
            })}
            {field("maxStudents", "Max students", {
              inputMode: "numeric",
              placeholder: String(parameters.maxStudents),
            })}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={draft.studentProposed}
              id={`${id}-studentProposed`}
              onCheckedChange={(checked) =>
                set("studentProposed")(checked === true)
              }
            />
            <Label htmlFor={`${id}-studentProposed`}>Student proposed</Label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("proposerName", "Proposer name")}
            {field("proposerEmail", "Proposer email", { type: "email" })}
            {field("mentorName", "Mentor name")}
            {field("mentorEmail", "Mentor email", { type: "email" })}
          </div>
          <FieldError message={error} />
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button type="submit">Add project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
