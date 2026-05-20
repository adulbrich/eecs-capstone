import type { ReactNode } from "react";

type Props = {
  columns: string[];
  children: ReactNode;
};

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
              key={c}
              className="border border-border p-2 text-left font-medium"
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
