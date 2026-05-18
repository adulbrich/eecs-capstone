import type { ReactNode } from "react";

type Props = {
  columns: string[];
  children: ReactNode;
};

export function AdminTable({ columns, children }: Props) {
  return (
    <table className="mt-4 w-full border-collapse border border-neutral-200 text-sm dark:border-neutral-800">
      <thead className="bg-neutral-100 dark:bg-neutral-900">
        <tr>
          {columns.map((c) => (
            <th
              key={c}
              className="border border-neutral-200 p-2 text-left font-medium dark:border-neutral-800"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
