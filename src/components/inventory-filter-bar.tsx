import { useDebouncedDraft } from "#/lib/use-debounced-draft";
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

type StatusFilter =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | null;

interface Props {
  categories: { id: string; name: string }[];
  onCategoriesChange: (next: string[]) => void;
  onQChange: (q: string) => void;
  onStatusChange: (s: StatusFilter) => void;
  onViewChange: (v: "card" | "row") => void;
  q: string;
  selectedCategories: string[];
  status: StatusFilter;
  view: "card" | "row";
}

const STATUS_OPTIONS: { value: NonNullable<StatusFilter>; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "requested", label: "Requested" },
  { value: "reserved", label: "Reserved" },
  { value: "checked_out", label: "Checked out" },
  { value: "maintenance", label: "Maintenance" },
];

export function InventoryFilterBar(props: Props) {
  const [localQ, setLocalQ] = useDebouncedDraft(props.q, props.onQChange);

  function toggleCategory(id: string) {
    const next = props.selectedCategories.includes(id)
      ? props.selectedCategories.filter((c) => c !== id)
      : [...props.selectedCategories, id];
    props.onCategoriesChange(next);
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <Input
          className="flex-1"
          onChange={(e) => setLocalQ(e.target.value)}
          placeholder="Search inventory"
          value={localQ}
        />
        <ViewToggle onChange={props.onViewChange} value={props.view} />
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
    </div>
  );
}
