import { ACTIVE_STATUSES, type ActiveStatus } from "#/lib/inventory-visibility";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { Card } from "./ui/card";
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
type StatusFilter = ActiveStatus | null;

interface Props {
  categories: { id: string; name: string }[];
  onCategoriesChange: (next: string[]) => void;
  onQChange: (q: string) => void;
  onStatusChange: (s: StatusFilter) => void;
  onViewChange: (view: ViewMode) => void;
  q: string;
  selectedCategories: string[];
  status: StatusFilter;
  view: ViewMode;
}

// A label per status, keyed by the union so a new one cannot reach the
// dropdown unlabelled, and ordered by the vocabulary rather than by hand.
const STATUS_LABEL: Record<ActiveStatus, string> = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  checked_out: "Checked out",
  maintenance: "Maintenance",
};

const STATUS_OPTIONS = ACTIVE_STATUSES.map((value) => ({
  label: STATUS_LABEL[value],
  value,
}));

export function InventoryFilterBar(props: Props) {
  const [localQ, setLocalQ] = useDebouncedDraft(props.q, props.onQChange);

  function toggleCategory(id: string) {
    const next = props.selectedCategories.includes(id)
      ? props.selectedCategories.filter((c) => c !== id)
      : [...props.selectedCategories, id];
    props.onCategoriesChange(next);
  }

  return (
    <Card className="bg-transparent p-4">
      <div className="flex items-center gap-3">
        <Input
          aria-label="Search inventory"
          className="flex-1"
          onChange={(e) => setLocalQ(e.target.value)}
          placeholder="Search inventory"
          value={localQ}
        />
        <ViewToggle current={props.view} onChange={props.onViewChange} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-filter-status">Status</Label>
          <Select
            onValueChange={(v) =>
              props.onStatusChange(v === "_all_" ? null : (v as StatusFilter))
            }
            value={props.status ?? "_all_"}
          >
            <SelectTrigger className="w-full" id="inv-filter-status">
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
      </div>

      {props.categories.length > 0 && (
        <fieldset className="mt-3">
          <legend className="font-medium text-muted-foreground text-xs">
            Categories (matches all selected)
          </legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {props.categories.map((c) => (
              <Label className="font-normal" key={c.id}>
                <Checkbox
                  checked={props.selectedCategories.includes(c.id)}
                  onCheckedChange={() => toggleCategory(c.id)}
                />
                {c.name}
              </Label>
            ))}
          </div>
        </fieldset>
      )}
    </Card>
  );
}
