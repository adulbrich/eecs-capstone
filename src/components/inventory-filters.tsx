import { useId } from "react";
import { ACTIVE_STATUSES, type ActiveStatus } from "#/lib/inventory-visibility";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { Checkbox } from "./ui/checkbox";
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
export type StatusFilter = ActiveStatus | null;

// A label per status, keyed by the union so a new one cannot reach the
// dropdown unlabelled, and ordered by the vocabulary rather than by hand.
export const INVENTORY_STATUS_LABEL: Record<ActiveStatus, string> = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  checked_out: "Checked out",
  maintenance: "Maintenance",
};

const STATUS_OPTIONS = ACTIVE_STATUSES.map((value) => ({
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
  return (
    <>
      <Input
        aria-label="Search inventory"
        className="min-w-0 flex-1 basis-64"
        onChange={(e) => setLocalQ(e.target.value)}
        placeholder="Search inventory"
        type="search"
        value={localQ}
      />
      <ViewToggle current={view} onChange={onViewChange} />
    </>
  );
}

interface FiltersProps {
  categories: { id: string; name: string }[];
  onCategoriesChange: (next: string[]) => void;
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
  onStatusChange,
  selectedCategories,
  status,
}: FiltersProps) {
  const uid = useId();

  function toggleCategory(id: string) {
    onCategoriesChange(
      selectedCategories.includes(id)
        ? selectedCategories.filter((c) => c !== id)
        : [...selectedCategories, id]
    );
  }

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
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {categories.length > 0 && (
        <fieldset>
          <legend className="font-medium text-muted-foreground text-xs">
            Categories (matches all selected)
          </legend>
          <div className="mt-1 space-y-1">
            {categories.map((c) => (
              <Label className="min-h-7 font-normal" key={c.id}>
                <Checkbox
                  checked={selectedCategories.includes(c.id)}
                  onCheckedChange={() => toggleCategory(c.id)}
                />
                {c.name}
              </Label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
