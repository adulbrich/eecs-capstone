import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  columns: string[];
}

export function AdminTable({ columns, children }: Props) {
  return (
    <table
      className="admin-table mt-4 w-full border-collapse border border-border text-sm"
      data-columns={columns.join(",")}
    >
      <thead className="bg-secondary">
        <tr>
          {columns.map((c) => (
            <th
              className="border border-border p-2 text-left font-medium"
              key={c}
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
