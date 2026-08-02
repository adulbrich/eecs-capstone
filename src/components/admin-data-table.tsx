import {
  type ColumnDef,
  type ColumnSort,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingFn,
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

// Hoisted once rather than constructed per comparison, the same reasoning
// that keeps regex literals out of loops: a Collator is comparatively
// expensive to build and this one is reused for every text comparison in
// every table. Locale is pinned to "en" (not undefined) to ensure
// deterministic sort order across server-side rendering and client hydration.
const collator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * The default sort for any column that does not set its own `sortingFn`.
 * `localeCompare`-equivalent (via `Intl.Collator`) rather than TanStack's
 * built-in `"text"`, which lowercases and compares by code point: under that
 * scheme an accented name like "Émile" sorts after "z" because U+00E9 is
 * greater than U+007A. `sensitivity: "base"` keeps the case-insensitivity
 * `"text"` had, while ordering accented letters among their unaccented peers
 * the way a reader expects.
 */
const localeCompareSortingFn: SortingFn<unknown> = (rowA, rowB, columnId) =>
  collator.compare(
    String(rowA.getValue(columnId)),
    String(rowB.getValue(columnId))
  );

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
 *
 * `cardHeader` marks the column that titles the record: on mobile its cell
 * becomes the card's header strip, spanning the full width with no field
 * name in front of it. Use it for a column whose content already says what
 * it is (a name or a title, usually beside a thumbnail), where a "Name"
 * label would only squeeze the title into what is left of the row. At most
 * one column per table should set it.
 */
export type AdminColumn<T> = ColumnDef<T, unknown> & {
  cardHeader?: boolean;
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
  const cardHeaderIds = useMemo(
    () =>
      new Set(
        columns.filter((column) => column.cardHeader).map((column) => column.id)
      ),
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
  // `sortingFn` to the locale-aware comparator above instead.
  const columnsWithSorting = useMemo(
    () =>
      columns.map(
        (column): AdminColumn<T> =>
          column.sortingFn
            ? column
            : {
                ...column,
                // localeCompareSortingFn only reads its rows through
                // `getValue`, so it works identically for every T; the cast
                // just tells TanStack's contravariant SortingFn<T> that.
                sortingFn: localeCompareSortingFn as SortingFn<T>,
              }
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

  // The row count alone leaves the table's order silently unannounced: when
  // the sorted column is hidden (its header, and the aria-sort it carries,
  // are not in the DOM at all), nothing else tells a screen reader user which
  // way the rows are ordered. Naming it here, from the same `labels` map the
  // header text and each cell's `data-label` already use, keeps the announced
  // column name in sync with what a sighted user would see if that column
  // were visible.
  const rowCountText = rows.length === 1 ? "1 row" : `${rows.length} rows`;
  const sortedLabel = labels.get(sort.id) ?? sort.id;
  const orderText = `sorted by ${sortedLabel}, ${sort.desc ? "descending" : "ascending"}`;

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
            {/*
              Default size, not sm: this button sits on the same row as the
              page's search input and filter selects, which are all h-9. An
              h-8 button beside them reads as misaligned rather than compact.
            */}
            <Button variant="outline">
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
        {`${rowCountText}, ${orderText}`}
      </p>

      {/*
        The container carries the surface, not the table: at md and up the
        admin table reads as one card, matching the rest of the app's
        bordered, rounded surfaces. Without a background of its own it sits on
        the page gradient, which is lightest and orange-tinted near the top of
        the page, so orange title links lose contrast there. Below md this is
        skipped, because `src/styles.css` already gives each row its own card.
      */}
      {rows.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <Table
          className="admin-table"
          containerClassName="mt-4 md:rounded-lg md:border md:border-border md:bg-card"
        >
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const label = labels.get(header.column.id) ?? "";
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead
                      aria-sort={canSort ? ariaSort(direction) : undefined}
                      className="bg-secondary md:sticky md:top-0 md:z-10"
                      key={header.id}
                      scope="col"
                    >
                      {canSort ? (
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
                {row.getVisibleCells().map((cell) => {
                  // A card-header cell carries no data-label on purpose: the
                  // mobile field name is drawn from that attribute, and this
                  // cell is the card's title rather than one of its fields.
                  const isCardHeader = cardHeaderIds.has(cell.column.id);
                  return (
                    <TableCell
                      data-card-header={isCardHeader ? "" : undefined}
                      data-label={
                        isCardHeader
                          ? undefined
                          : (labels.get(cell.column.id) ?? "")
                      }
                      key={cell.id}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
