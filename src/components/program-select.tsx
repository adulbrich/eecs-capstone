import { useEffect, useState } from "react";
import { listPrograms } from "#/server/programs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type Program = {
  id: string;
  courseId: string;
  courseName: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  id?: string;
};

// Radix Select reserves the empty string, so the "(no program)" choice uses
// a sentinel. The form still stores "" for no program.
const NONE = "_none_";

export function ProgramSelect({
  value,
  onChange,
  allowEmpty = true,
  id,
}: Props) {
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listPrograms();
        setPrograms(rows as Program[]);
      } catch {
        setPrograms([]);
      }
    })();
  }, []);

  return (
    <Select
      value={value === "" ? NONE : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger id={id} className="mt-1 w-full" aria-label="Program">
        <SelectValue placeholder="Select a program" />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>(no program)</SelectItem>}
        {programs.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.courseId} {p.courseName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
