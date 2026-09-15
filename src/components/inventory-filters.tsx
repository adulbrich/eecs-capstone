import { useId } from "react";
import { ACTIVE_STATUSES, type ActiveStatus } from "#/lib/inventory-visibility";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
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
  onQChange: (q: string) => void;
  onViewChange: (view: ViewMode) => void;
  q: string;
  view: ViewMode;
}

/**
 * The top of the listing at every width: the search and the card/table
 * toggle. Neither narrows the list, which is why they stay beside the
 * Filters button rather than inside the aside. The route passes a stable
 * `onQChange`: the debounce keys its timer on it.
 */
export function InventorySearchBar({
  onQChange,
  onViewChange,
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
      <SearchHint fields="names and descriptions" id={hintId} />
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
