import { useEffect, useState } from "react";
import { listPrograms } from "#/server/programs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Program {
  courseId: string;
  courseName: string;
  id: string;
}

interface Props {
  allowEmpty?: boolean;
  id?: string;
  onChange: (value: string) => void;
  value: string;
}

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
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      value={value === "" ? NONE : value}
    >
      <SelectTrigger aria-label="Program" className="mt-1 w-full" id={id}>
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
