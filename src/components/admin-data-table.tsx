import {
  type ColumnDef,
  type ColumnSort,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp, Columns3 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { EmptyState } from "#/components/empty-state";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import {
  clearStoredHidden,
  type SortState,
  serializeHidden,
  writeStoredHidden,
} from "#/lib/table-state";

/**
 * A column definition for an admin table.
 *
 * `header` is narrowed to a plain string and `id` is required, because both
 * are load-bearing beyond rendering: the header text is reused verbatim as
 * every body cell's `data-label`, which is what `src/styles.css` turns into
 * the field name on mobile cards, and the id is what the URL carries.
 *
 * `defaultHidden` is the single source of truth for a column's initial
 * visibility. There is deliberately no separate list of defaults to keep in
 * sync with it.
 */
export type AdminColumn<T> = ColumnDef<T, unknown> & {
  defaultHidden?: boolean;
  header: string;
  id: string;
};

export interface AdminDataTableProps<T> {
  caption: string;
  columns: AdminColumn<T>[];
  data: T[];
  defaultSort: SortState;
  emptyMessage: string;
  getRowId: (row: T) => string;
  hidden: string[];
  onHiddenChange: (cols: string | undefined) => void;
  onSortChange: (sort: SortState) => void;
  /**
   * Set when the server already ordered the rows and will reorder them on the
   * next request, which is the case for any paginated listing. Header clicks
   * still report through onSortChange and aria-sort still reflects the current
   * column; only the local reordering is skipped, because sorting one page of
   * rows in the browser would sort a slice while appearing to sort the whole
   * table.
   */
  serverSorted?: boolean;
  sort: SortState;
  storageKey: string;
  toolbar?: ReactNode;
}

function ariaSort(
  direction: false | "asc" | "desc"
): "ascending" | "descending" | "none" {
  if (direction === "asc") {
    return "ascending";
  }
  if (direction === "desc") {
    return "descending";
  }
  return "none";
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ChevronUp aria-hidden className="size-3.5" />;
  }
  if (direction === "desc") {
    return <ChevronDown aria-hidden className="size-3.5" />;
  }
  return <ChevronsUpDown aria-hidden className="size-3.5 opacity-40" />;
}

/**
 * The shared staff table. Sorting and column visibility are controlled by the
 * caller, which keeps the URL as the single source of truth and lets this
 * render in tests without a router.
 */
export function AdminDataTable<T>({
  caption,
  columns,
  data,
  defaultSort,
  emptyMessage,
  getRowId,
  hidden,
  onHiddenChange,
  onSortChange,
  serverSorted,
  sort,
  storageKey,
  toolbar,
}: AdminDataTableProps<T>) {
  // The header string doubles as each cell's `data-label`, so read it from our
  // own column list rather than from TanStack's widened `columnDef.header`,
  // whose type also admits render functions.
  const labels = useMemo(
    () => new Map(columns.map((column) => [column.id, column.header])),
    [columns]
  );
  const defaultHidden = useMemo(
    () =>
      columns
        .filter((column) => column.defaultHidden)
        .map((column) => column.id),
    [columns]
  );

  // TanStack auto-detects `alphanumeric` sorting for columns whose sample
  // values look numeric-ish; default every column without its own
  // `sortingFn` to `text`, which is what case-insensitive comparison needs.
  const columnsWithSorting = useMemo(
    () =>
      columns.map((column) =>
        column.sortingFn ? column : { ...column, sortingFn: "text" as const }
      ),
    [columns]
  );

  const sorting: SortingState = useMemo(
    () => [{ desc: sort.desc, id: sort.id }],
    [sort.desc, sort.id]
  );
  const columnVisibility: VisibilityState = useMemo(
    () => Object.fromEntries(hidden.map((id) => [id, false])),
    [hidden]
  );

  const table = useReactTable({
    columns: columnsWithSorting,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    manualSorting: serverSorted ?? false,
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      const nextHidden = Object.entries(next)
        .filter(([, visible]) => !visible)
        .map(([id]) => id);
      const serialized = serializeHidden(nextHidden, defaultHidden);
      // A toggle that lands back on the page default hits the same trap as
      // an explicit reset: writing the literal default set into storage
      // would leave a "preference" on record, and the seed effect would
      // write it straight back into the URL the next time cols is
      // undefined, undoing the clean URL serializeHidden just produced.
      if (serialized === undefined) {
        clearStoredHidden(storageKey);
      } else {
        writeStoredHidden(storageKey, nextHidden);
      }
      onHiddenChange(serialized);
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first: ColumnSort = next[0] ?? {
        desc: defaultSort.desc,
        id: defaultSort.id,
      };
      onSortChange({ desc: first.desc, id: first.id });
    },
    state: { columnVisibility, sorting },
  });

  const rows = table.getRowModel().rows;
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());

  const resetColumns = () => {
    // Clear the stored preference rather than writing the default set into
    // it. "Reset" means "I no longer have a preference," not "my preference
    // happens to equal the default." Writing the latter would leave a
    // preference on record, and useSeedColumnsFromStorage would dutifully
    // seed it straight back into the URL the next time cols is undefined,
    // undoing the clean URL that onHiddenChange(undefined) just produced.
    clearStoredHidden(storageKey);
    onHiddenChange(undefined);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">{toolbar}</div>
        {/*
          modal={false}: Radix's default modal DropdownMenu hides the rest of
          the page from assistive tech via `aria-hidden` (not `inert`) while
          it's open: @radix-ui/react-menu calls `hideOthers` from the
          `aria-hidden` package directly rather than its `inert`-aware
          `suppressOthers`. That leaves every focusable element outside the
          menu (nav links, the search box, sort buttons) inside an
          aria-hidden subtree, which axe correctly flags as
          aria-hidden-focus. This menu is a lightweight column toggle, not a
          workflow that needs a hard focus trap, so opting out of modal
          behavior is the right fix here rather than living with the
          violation or fighting Radix's internals.
        */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Columns3 aria-hidden className="size-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hideable.map((column) => (
              <DropdownMenuCheckboxItem
                checked={column.getIsVisible()}
                key={column.id}
                onCheckedChange={(value) => column.toggleVisibility(value)}
                onSelect={(event) => event.preventDefault()}
              >
                {labels.get(column.id) ?? column.id}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetColumns}>
              Reset columns
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p aria-live="polite" className="sr-only">
        {rows.length === 1 ? "1 row" : `${rows.length} rows`}
      </p>

      {rows.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <Table className="admin-table mt-4">
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const label = labels.get(header.column.id) ?? "";
                  return (
                    <TableHead
                      aria-sort={ariaSort(direction)}
                      className="bg-secondary md:sticky md:top-0 md:z-10"
                      key={header.id}
                      scope="col"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {label}
                          <SortIcon direction={direction} />
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    data-label={labels.get(cell.column.id) ?? ""}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
