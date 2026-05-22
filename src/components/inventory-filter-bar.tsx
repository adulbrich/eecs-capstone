import { useEffect, useState } from "react";
import { Input } from "./ui/input";
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
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <Input
        value={localQ}
        onChange={(e) => setLocalQ(e.target.value)}
        placeholder="Search inventory"
        className="md:flex-1"
      />
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() =>
              props.onStatusChange(
                props.status === opt.value ? null : opt.value,
              )
            }
            className={
              props.status === opt.value
                ? "rounded border-2 px-2 py-1 text-xs"
                : "rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground"
            }
            style={
              props.status === opt.value
                ? { borderColor: "var(--brand-primary)" }
                : undefined
            }
          >
            {opt.label}
          </button>
        ))}
        <Select
          value={props.category ?? "_all_"}
          onValueChange={(v) =>
            props.onCategoryChange(v === "_all_" ? null : v)
          }
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="Category" />
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
        <ViewToggle value={props.view} onChange={props.onViewChange} />
      </div>
    </div>
  );
}
