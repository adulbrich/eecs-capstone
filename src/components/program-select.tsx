import { useEffect, useState } from "react";
import { listPrograms } from "#/server/programs";

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
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full border bg-white p-2 dark:bg-neutral-900"
    >
      {allowEmpty && <option value="">(no program)</option>}
      {programs.map((p) => (
        <option key={p.id} value={p.id}>
          {p.courseId} {p.courseName}
        </option>
      ))}
    </select>
  );
}
