import { useEffect, useState } from "react";
import {
  addProgramInstructor,
  listEligibleInstructors,
  removeProgramInstructor,
} from "#/server/programs";
import { Button } from "./ui/button";
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
  const [error, setError] = useState<string | null>(null);

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

  async function add() {
    setError(null);
    if (!picked) {
      return;
    }
    try {
      await addProgramInstructor({ data: { programId, userId: picked } });
      setPicked("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(userId: string) {
    setError(null);
    try {
      await removeProgramInstructor({ data: { programId, userId } });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
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
                className="text-destructive hover:text-destructive"
                onClick={() => void remove(i.userId)}
                size="xs"
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
        <Select onValueChange={setPicked} value={picked}>
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
          disabled={!picked}
          onClick={() => void add()}
          size="sm"
          type="button"
        >
          Add
        </Button>
      </div>
      {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
    </section>
  );
}
