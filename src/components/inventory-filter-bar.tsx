import { useEffect, useState } from "react";
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

type Props = {
  q: string;
  status: StatusFilter;
  category: string | null;
  view: "card" | "row";
  categories: string[];
  onQChange: (q: string) => void;
  onStatusChange: (s: StatusFilter) => void;
  onCategoryChange: (c: string | null) => void;
  onViewChange: (v: "card" | "row") => void;
};

const STATUS_OPTIONS: { value: NonNullable<StatusFilter>; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "requested", label: "Requested" },
  { value: "reserved", label: "Reserved" },
  { value: "checked_out", label: "Checked out" },
  { value: "maintenance", label: "Maintenance" },
];

export function InventoryFilterBar(props: Props) {
  const [localQ, setLocalQ] = useState(props.q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (localQ !== props.q) props.onQChange(localQ);
    }, 300);
    return () => clearTimeout(t);
  }, [localQ, props]);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <Input
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
          placeholder="Search inventory"
          className="flex-1"
        />
        <ViewToggle value={props.view} onChange={props.onViewChange} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-filter-category">Category</Label>
          <Select
            value={props.category ?? "_all_"}
            onValueChange={(v) =>
              props.onCategoryChange(v === "_all_" ? null : v)
            }
          >
            <SelectTrigger id="inv-filter-category" className="w-full">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All categories</SelectItem>
              {props.categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-filter-status">Status</Label>
          <Select
            value={props.status ?? "_all_"}
            onValueChange={(v) =>
              props.onStatusChange(v === "_all_" ? null : (v as StatusFilter))
            }
          >
            <SelectTrigger id="inv-filter-status" className="w-full">
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
    </div>
  );
}
