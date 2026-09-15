import { useEffect, useState } from "react";
import { useAction } from "#/lib/use-action";
import {
  addProgramInstructor,
  listEligibleInstructors,
  removeProgramInstructor,
} from "#/server/programs";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Instructor {
  email: string;
  name: string | null;
  role: string | null;
  userId: string;
}

interface Eligible {
  email: string;
  id: string;
  name: string | null;
  role: string | null;
}

interface Props {
  initial: Instructor[];
  onChanged: () => void;
  programId: string;
}

export function InstructorManager({ programId, initial, onChanged }: Props) {
  const [instructors, setInstructors] = useState(initial);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [picked, setPicked] = useState("");
  // One flight for the whole panel: Add and every Remove write the same list
  // and share the one error slot under it.
  const { busy, error, run } = useAction();

  useEffect(() => setInstructors(initial), [initial]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listEligibleInstructors();
        setEligible(rows as Eligible[]);
      } catch {
        setEligible([]);
      }
    })();
  }, []);

  function add() {
    if (!picked) {
      return;
    }
    void run(async () => {
      await addProgramInstructor({ data: { programId, userId: picked } });
      setPicked("");
      onChanged();
    }, "Could not add the instructor");
  }

  function remove(userId: string) {
    void run(async () => {
      await removeProgramInstructor({ data: { programId, userId } });
      onChanged();
    }, "Could not remove the instructor");
  }

  const currentIds = new Set(instructors.map((i) => i.userId));
  const remaining = eligible.filter((e) => !currentIds.has(e.id));

  return (
    <section className="mt-6">
      <h2 className="font-medium text-sm">Instructors</h2>
      {instructors.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {instructors.map((i) => (
            <li
              className="flex items-center justify-between rounded-md border border-border p-2"
              key={i.userId}
            >
              <span>
                {i.name ?? i.email}{" "}
                <span className="text-muted-foreground text-xs">
                  ({i.role})
                </span>
              </span>
              <Button
                disabled={busy}
                onClick={() => remove(i.userId)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Select disabled={busy} onValueChange={setPicked} value={picked}>
          <SelectTrigger aria-label="Add instructor" className="w-64" size="sm">
            <SelectValue placeholder="Add instructor..." />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name ?? e.email} ({e.role})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={busy || !picked}
          onClick={add}
          size="sm"
          type="button"
        >
          {busy ? "Saving..." : "Add"}
        </Button>
      </div>
      <FieldError message={error} />
    </section>
  );
}
