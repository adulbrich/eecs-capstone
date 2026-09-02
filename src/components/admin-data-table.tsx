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
import { type ReactNode, useEffect, useMemo, useRef } from "react";
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
export type AdminColumn<T> = ColumnDef<T, unknown> & AdminColumnExtras;

/** The fields `AdminColumn` adds on top of TanStack's `ColumnDef`. */
interface AdminColumnExtras {
  cardHeader?: boolean;
  defaultHidden?: boolean;
  header: string;
  id: string;
}

/**
 * `AdminColumn` with the accessor's return type left as a parameter instead
 * of erased to `unknown`, which is what lets `CheckedAdminColumn` see what a
 * column sorts on.
 *
 * The two `never`s close the ways around the check. Leaving `accessorKey` and
 * `columns` out of the constraint is not enough on its own: `C` is inferred
 * from the array literal, so there is no fixed target type for excess-property
 * checking to fire against, and a property the constraint merely fails to
 * mention is simply allowed. An `accessorKey` column carries a value type
 * `CheckedAdminColumn` cannot read, and a grouped column hides its real
 * columns one level down where nothing inspects them; both compiled with no
 * rule applied. Banning them costs nothing: no column under
 * `src/routes/_authed/admin/` uses either.
 */
type TypedAdminColumn<T, TValue> = Omit<ColumnDef<T, unknown>, "accessorFn"> &
  AdminColumnExtras & {
    accessorFn?: (row: T, index: number) => TValue;
    accessorKey?: never;
    columns?: never;
  };

type ColumnId<C> = C extends { id: infer TId } ? TId : never;

/**
 * Resolves to `C` when a column honours both rules that depend on what its
 * accessor returns, and to an error object naming the offending column
 * otherwise:
 *
 * 1. A column whose value is not text sets its own `sortingFn`, because the
 *    default comparator sorts `String(value)` (see `localeCompareSortingFn`).
 *    "Sets" means to a real comparator: the presence test is against
 *    `NonNullable<unknown>` rather than `unknown` because `undefined` is
 *    assignable to `unknown`, so an explicit `sortingFn: undefined` would
 *    otherwise satisfy a rule it declares nothing about.
 * 2. An accessor returns `undefined`, never `null`, for a missing value.
 *    `sortUndefined` is the only knob TanStack offers for grouping empties,
 *    and it does not treat `null` as empty, so a `null` sorts as the string
 *    "null" among the real values.
 *
 * The null check comes first: an accessor returning `string | null` breaks
 * rule 2 while looking like text to rule 1, and reporting the sorting
 * failure there would send the reader after the wrong fix.
 *
 * A column with no `accessorFn` at all (an actions column, say) has no value
 * to sort and passes through untouched.
 */
type CheckedAdminColumn<C> = C extends {
  accessorFn: (...args: never[]) => infer TValue;
}
  ? [null] extends [TValue]
    ? { ACCESSOR_RETURNS_NULL_USE_UNDEFINED: ColumnId<C> }
    : [TValue] extends [string | undefined]
      ? C
      : C extends { sortingFn: NonNullable<unknown> }
        ? C
        : { COLUMN_NEEDS_ITS_OWN_SORTING_FN: ColumnId<C> }
  : C;

type CheckedAdminColumns<C extends readonly unknown[]> = {
  [K in keyof C]: CheckedAdminColumn<C[K]>;
};

/**
 * Builds a checked column list for one admin table. Call as
 * `defineAdminColumns<Row>()([...])`.
 *
 * Curried for the same reason as `defineCsvColumns` in `#/lib/csv`:
 * TypeScript infers all type arguments or none, so giving `T` explicitly in
 * one call would force `C` to be given too, and `C` is exactly what has to be
 * inferred from the array literal. `const C` is what keeps each element's
 * accessor return type visible per element rather than unioned across the
 * array.
 *
 * The two rules it enforces used to live only in `docs/UI-CONVENTIONS.md` and
 * in a comment on the route where someone hit the second one. Both fail
 * quietly: the table renders, sorts, and looks fine, in the wrong order.
 *
 * A shared column const declared outside the array uses `satisfies
 * AdminColumn<Row>` with `id: "..." as const`, never an `AdminColumn<Row>`
 * annotation: the annotation erases the accessor's return type back to
 * `unknown`, `[null] extends [unknown]` is true, and every such column would
 * then report as returning null. See `docs/QUIRKS.md`. Annotating the
 * returned array is merely redundant and still checks.
 */
export function defineAdminColumns<T>() {
  return <const C extends readonly TypedAdminColumn<T, unknown>[]>(
    columns: C & CheckedAdminColumns<C>
  ): AdminColumn<T>[] =>
    // The one cast in the construct, and it is the price of the check. `const
    // C` is what preserves each accessor's return type per element, and it
    // also makes every element deeply readonly and literal. The table and
    // `useAdminTable` consume `AdminColumn<T>[]`, and no structural
    // conversion gets there from a readonly tuple of literals: a single
    // `as AdminColumn<T>[]` fails TS2352, which is why it goes through
    // `unknown`.
    columns as unknown as AdminColumn<T>[];
}

export interface AdminDataTableProps<T> {
  /**
   * Controls rendered in the right-hand group, before the Columns menu.
   * A slot rather than an `onExport` callback: the export needs per-route
   * column definitions and filter state, and threading those through here
   * would make the table know about exports.
   */
  actions?: ReactNode;
  caption: string;
  columns: AdminColumn<T>[];
  data: T[];
  defaultSort: SortState;
  emptyMessage: string;
  getRowId: (row: T) => string;
  hidden: string[];
  /**
   * A row to mark and scroll to, matched against `getRowId`. Used by links
   * that name one record, so the reader lands on it rather than hunting for
   * it. An id matching no row degrades to the plain table: a link can outlive
   * the row it named.
   */
  highlightedRowId?: string | null;
  onHiddenChange: (cols: string | undefined) => void;
  onSortChange: (sort: SortState) => void;
  /**
   * Reports the ids of the rows in their current sorted (rendered) order,
   * via `getRowId`, every time sorting or the underlying data changes. Not
   * called when `serverSorted` is set: there the rows already arrived in
   * server order, `data` already holds that order, and the caller has no use
   * for a second copy of it.
   *
   * The intended consumer is an export handler: ordering the exported rows
   * by this id sequence (see `orderBySortedIds` in `#/lib/csv`) makes the
   * file's row order match the screen by construction, without a route
   * hand-copying this table's sort comparators (the default locale-aware
   * one, a column's own `sortingFn`, or a custom order like status).
   */
  onSortedIdsChange?: (ids: string[]) => void;
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
  actions,
  caption,
  columns,
  data,
  defaultSort,
  emptyMessage,
  getRowId,
  hidden,
  highlightedRowId,
  onHiddenChange,
  onSortChange,
  onSortedIdsChange,
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
  const marked = useMemo(
    () =>
      columns.filter((column) => column.cardHeader).map((column) => column.id),
    [columns]
  );
  // Only the first marked column titles the card. Two header strips render as
  // two title rows on one mobile card, one of them unlabelled and neither
  // obviously wrong, so it reads as a styling oddity and gets lived with. The
  // prop's TSDoc has said "at most one" since it was added, where no compiler
  // could read it.
  const cardHeaderIds = useMemo(() => new Set(marked.slice(0, 1)), [marked]);
  // Joined so the dependency is stable by value rather than by array identity.
  const tooManyCardHeaders = marked.length > 1 ? marked.join(", ") : null;
  useEffect(() => {
    if (!tooManyCardHeaders) {
      return;
    }
    // Reported rather than thrown: nothing in this app declares an
    // `errorComponent`, so a render-time throw replaces the whole admin page,
    // and trading a squeezed card title for a blank screen is the worse bug.
    // In an effect rather than in the memo above because a memo can run and be
    // discarded, which would make the warning appear or not on a detail of
    // React's scheduling.
    console.error(
      `AdminDataTable: cardHeader is set on more than one column (${tooManyCardHeaders}). At most one column may title the mobile card, so only the first is used.`
    );
  }, [tooManyCardHeaders]);
  const highlighted = useRef<HTMLTableRowElement | null>(null);
  // Scrolls once the highlighted row has rendered. Deliberately runs on mount
  // only: re-sorting or re-filtering should not yank the viewport back.
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center" });
  }, []);

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

  // Reports the table's own sorted row order to the caller. Skipped when
  // serverSorted: the rows there are not locally reordered at all (see
  // manualSorting above), so `data`'s own order already is that order and
  // there is nothing this effect would add. Guarded inside the effect,
  // rather than by omitting the dependency, so a change to `serverSorted`
  // itself is still tracked correctly.
  useEffect(() => {
    if (serverSorted) {
      return;
    }
    onSortedIdsChange?.(rows.map((row) => row.id));
  }, [rows, serverSorted, onSortedIdsChange]);

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
        <div className="flex items-end gap-3">
          {actions}
          {/*
            modal={false}: Radix's default modal DropdownMenu hides the rest
            of the page from assistive tech via `aria-hidden` (not `inert`)
            while it's open: @radix-ui/react-menu calls `hideOthers` from the
            `aria-hidden` package directly rather than its `inert`-aware
            `suppressOthers`. That leaves every focusable element outside the
            menu (nav links, the search box, sort buttons) inside an
            aria-hidden subtree, which axe correctly flags as
            aria-hidden-focus. This menu is a lightweight column toggle, not
            a workflow that needs a hard focus trap, so opting out of modal
            behavior is the right fix here rather than living with the
            violation or fighting Radix's internals.
          */}
          {/*
            No menu when nothing can be hidden: a table whose columns are all
            `enableHiding: false` (the bookmarks shortlist) would otherwise
            offer an empty picker, a control that exists to be ignored.
          */}
          {hideable.length > 0 && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                {/*
                Default size, not sm: this button sits on the same row as
                the page's search input and filter selects, which are all
                h-9. An h-8 button beside them reads as misaligned rather
                than compact.
              */}
                <Button variant="outline">
                  <Columns3 aria-hidden className="size-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              {/*
              tabIndex 0, not Radix's -1: a menu with enough columns to
              scroll (the public projects table has fifteen) fails axe's
              scrollable-region-focusable otherwise. See docs/QUIRKS.md,
              "A Columns menu that scrolls must be focusable itself".
            */}
              <DropdownMenuContent align="end" tabIndex={0}>
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
          )}
        </div>
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
            {rows.map((row) => {
              const isHighlighted =
                !!highlightedRowId && row.id === highlightedRowId;
              return (
                <TableRow
                  // The documented highlight token, not a colour of its own.
                  className={
                    isHighlighted ? "bg-[var(--brand-primary-tint)]" : undefined
                  }
                  data-highlighted={isHighlighted ? "" : undefined}
                  key={row.id}
                  ref={isHighlighted ? highlighted : undefined}
                >
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
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
