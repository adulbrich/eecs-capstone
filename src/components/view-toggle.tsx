import { LayoutGrid, Table } from "lucide-react";
import { cn } from "#/lib/utils.ts";
import { type ViewMode, writeStoredView } from "#/lib/view-preference";
import { Button } from "./ui/button";

/**
 * The card/table switch on the two public listings. It writes the choice to
 * storage and hands it to the route, which owns the `?view=` param: the two
 * routes navigate from different paths, and `useNavigate({ from })` typechecks
 * only against a literal one.
 */
export function ViewToggle({
  current,
  onChange,
}: {
  current: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  function setMode(view: ViewMode) {
    if (view === current) {
      return;
    }
    writeStoredView(view);
    onChange(view);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: aria role=group with label is the right pattern for paired toggle buttons
    <div aria-label="View mode" className="flex" role="group">
      <Button
        aria-label="Card view"
        aria-pressed={current === "card"}
        className={cn("rounded-r-none", current === "card" && "bg-secondary")}
        onClick={() => setMode("card")}
        size="icon"
        type="button"
        variant="outline"
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        aria-label="Table view"
        aria-pressed={current === "table"}
        className={cn(
          "-ml-px rounded-l-none",
          current === "table" && "bg-secondary"
        )}
        onClick={() => setMode("table")}
        size="icon"
        type="button"
        variant="outline"
      >
        <Table className="h-4 w-4" />
      </Button>
    </div>
  );
}
