import { useId } from "react";
import { ACTIVE_STATUSES, type ActiveStatus } from "#/lib/inventory-visibility";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { INVENTORY_ORDERS, type InventoryOrder } from "#/server/inventory";
import {
  CategoryCheckboxList,
  type CategoryOption,
} from "./category-checkbox-list";
import { ClearFiltersButton } from "./clear-filters-button";
import { SearchHint } from "./search-hint";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { ViewToggle } from "./view-toggle";

/** The working set, or null for no filter: retired is not offered here. */
type StatusFilter = ActiveStatus | null;

// A label per status, keyed by the union so a new one cannot reach the
// dropdown unlabelled, and ordered by the vocabulary rather than by hand.
export const INVENTORY_STATUS_LABEL: Record<ActiveStatus, string> = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  checked_out: "Checked out",
  maintenance: "Maintenance",
};

/** The status select's options, shared with the admin listing. */
export const INVENTORY_STATUS_OPTIONS = ACTIVE_STATUSES.map((value) => ({
  label: INVENTORY_STATUS_LABEL[value],
  value,
}));

/**
 * The Sort select's labels, keyed by the union so a new ordering cannot
 * reach the select unlabelled. Read as sentences rather than column names,
 * the way `PROJECT_ORDER_LABEL` does: the table's headers no longer sort,
 * and this is the listing's one ordering in both views (#477).
 */
export const INVENTORY_ORDER_LABEL: Record<InventoryOrder, string> = {
  available: "Available first",
  name: "Name A-Z",
  updated: "Recently updated",
};

/**
 * How many narrowing filters are on, for the Filters button below `xl`. A
 * category set counts once however many it holds: it is one decision.
 */
export function countActiveInventoryFilters(state: {
  categories: string[];
  status: StatusFilter;
}): number {
  return [state.status !== null, state.categories.length > 0].filter(Boolean)
    .length;
}

interface SearchProps {
  onOrderChange: (order: InventoryOrder) => void;
  onQChange: (q: string) => void;
  onViewChange: (view: ViewMode) => void;
  order: InventoryOrder;
  q: string;
  view: ViewMode;
}

/**
 * The top of the listing at every width: the search, the server order and
 * the card/table toggle. None of these narrows the list, which is why they
 * stay beside the Filters button rather than inside the aside. The route passes a stable
 * `onQChange`: the debounce keys its timer on it.
 */
export function InventorySearchBar({
  onOrderChange,
  onQChange,
  onViewChange,
  order,
  q,
  view,
}: SearchProps) {
  const [localQ, setLocalQ] = useDebouncedDraft(q, onQChange);
  // `useId` for the reason `ProjectsSearchBar` gives.
  const hintId = useId();
  return (
    <>
      <Input
        aria-describedby={hintId}
        aria-label="Search inventory"
        className="min-w-0 flex-1 basis-64"
        onChange={(e) => setLocalQ(e.target.value)}
        placeholder="Search inventory"
        type="search"
        value={localQ}
      />
      <SearchHint fields="names and descriptions" id={hintId} query={q} />
      <Select
        onValueChange={(v) => onOrderChange(v as InventoryOrder)}
        value={order}
      >
        {/* w-44: "Recently updated", the longest label, fits with room to
            spare, where /projects needs w-52 for "Recommended for you". */}
        <SelectTrigger aria-label="Sort" className="w-44" id="inventory-sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INVENTORY_ORDERS.map((value) => (
            <SelectItem key={value} value={value}>
              {INVENTORY_ORDER_LABEL[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ViewToggle current={view} onChange={onViewChange} />
    </>
  );
}

interface FiltersProps {
  categories: CategoryOption[];
  onCategoriesChange: (next: string[]) => void;
  /** Clear all: every narrowing filter off in one navigation. */
  onClear: () => void;
  onStatusChange: (s: StatusFilter) => void;
  selectedCategories: string[];
  status: StatusFilter;
}

/**
 * The narrowing controls, stacked for a column: `ListingLayout` puts them in
 * the aside from `xl` and in the sheet below it, so this mounts twice and
 * its ids come from `useId` (QUIRKS, "A listing's filters render twice").
 */
export function InventoryFilters({
  categories,
  onCategoriesChange,
  onClear,
  onStatusChange,
  selectedCategories,
  status,
}: FiltersProps) {
  const uid = useId();
  const active = countActiveInventoryFilters({
    categories: selectedCategories,
    status,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-status`}>Status</Label>
        <Select
          onValueChange={(v) =>
            onStatusChange(v === "_all_" ? null : (v as StatusFilter))
          }
          value={status ?? "_all_"}
        >
          <SelectTrigger className="w-full" id={`${uid}-status`}>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All statuses</SelectItem>
            {INVENTORY_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CategoryCheckboxList
        categories={categories}
        onChange={onCategoriesChange}
        selected={selectedCategories}
      />

      {active > 0 && <ClearFiltersButton onClick={onClear} />}
    </div>
  );
}
