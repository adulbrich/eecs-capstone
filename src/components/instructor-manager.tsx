import { useEffect, useState } from "react";
import {
  addProgramInstructor,
  listEligibleInstructors,
  removeProgramInstructor,
} from "#/server/programs";
import { Button } from "./ui/button";

type Instructor = {
  userId: string;
  name: string | null;
  email: string;
  role: string | null;
};

type Eligible = {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
};

type Props = {
  programId: string;
  initial: Instructor[];
  onChanged: () => void;
};

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
    if (!picked) return;
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
        <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {instructors.map((i) => (
            <li
              key={i.userId}
              className="flex items-center justify-between rounded-md border border-border p-2"
            >
              <span>
                {i.name ?? i.email}{" "}
                <span className="text-xs text-muted-foreground">
                  ({i.role})
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => void remove(i.userId)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">Add instructor...</option>
          {remaining.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name ?? e.email} ({e.role})
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          onClick={() => void add()}
          disabled={!picked}
        >
          Add
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
