import { describe, expect, it } from "vitest";
import { defineAdminColumns } from "#/components/admin-data-table";

interface Row {
  createdAt: Date;
  name: string;
  note: string | null;
  usageCount: number;
}

describe("defineAdminColumns", () => {
  it("accepts a compliant column list", () => {
    const columns = defineAdminColumns<Row>()([
      { accessorFn: (row) => row.name, header: "Name", id: "name" },
      {
        accessorFn: (row) => row.createdAt,
        header: "Created",
        id: "createdAt",
        sortingFn: "datetime",
      },
      {
        accessorFn: (row) => row.usageCount,
        header: "Uses",
        id: "usageCount",
        sortingFn: "basic",
      },
      {
        accessorFn: (row) => row.note ?? undefined,
        header: "Note",
        id: "note",
        sortUndefined: "last",
      },
      { header: "Actions", id: "actions" },
    ]);

    expect(columns.map((column) => column.id)).toEqual([
      "name",
      "createdAt",
      "usageCount",
      "note",
      "actions",
    ]);
  });

  // The cases below are the point of this file, and `npm run typecheck` is
  // what runs them: `tsconfig.json` includes `**/*.ts`, so tsc reads them even
  // though vitest is what reports these blocks green. A green typecheck over
  // the wrapped routes only proves the compliant shapes still compile; it says
  // nothing about whether the check rejects anything, and `CheckedAdminColumn`
  // could quietly degrade to a no-op without a single route failing.
  // `@ts-expect-error` inverts that: each directive turns into an "unused
  // '@ts-expect-error'" error the moment its line becomes legal again.
  it("rejects a Date column with no sortingFn", () => {
    defineAdminColumns<Row>()([
      // @ts-expect-error COLUMN_NEEDS_ITS_OWN_SORTING_FN: "createdAt"
      {
        accessorFn: (row) => row.createdAt,
        header: "Created",
        id: "createdAt",
      },
    ]);
  });

  it("rejects a number column with no sortingFn", () => {
    defineAdminColumns<Row>()([
      // @ts-expect-error COLUMN_NEEDS_ITS_OWN_SORTING_FN: "usageCount"
      { accessorFn: (row) => row.usageCount, header: "Uses", id: "usageCount" },
    ]);
  });

  it("does not count an explicitly undefined sortingFn as setting one", () => {
    defineAdminColumns<Row>()([
      // @ts-expect-error COLUMN_NEEDS_ITS_OWN_SORTING_FN: "createdAt"
      {
        accessorFn: (row) => row.createdAt,
        header: "Created",
        id: "createdAt",
        sortingFn: undefined,
      },
    ]);
  });

  it("rejects an accessorKey column, whose value type it cannot read", () => {
    defineAdminColumns<Row>()([
      // @ts-expect-error accessorKey is banned by `accessorKey?: never`
      { accessorKey: "createdAt", header: "Created", id: "createdAt" },
    ]);
  });

  it("rejects an accessor that returns null", () => {
    defineAdminColumns<Row>()([
      // A string-valued accessor that admits null trips the null rule rather
      // than passing as text, which is the order the two rules have to fire in.
      // @ts-expect-error ACCESSOR_RETURNS_NULL_USE_UNDEFINED: "note"
      { accessorFn: (row) => row.note, header: "Note", id: "note" },
    ]);
  });
});
