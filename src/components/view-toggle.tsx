import { useNavigate } from "@tanstack/react-router";
import { LayoutGrid, Table } from "lucide-react";
import { cn } from "#/lib/utils.ts";
import { type ViewMode, writeStoredView } from "#/lib/view-preference";
import { Button } from "./ui/button";

/**
 * The card/table switch on the public project listing. It writes the choice
 * to storage and into `?view=`, and the route reads the URL back; there is no
 * callback because the URL is the state.
 */
export function ViewToggle({ current }: { current: ViewMode }) {
  const navigate = useNavigate({ from: "/projects/" });

  function setMode(view: ViewMode) {
    if (view === current) {
      return;
    }
    writeStoredView(view);
    void navigate({
      search: (prev) => ({ ...prev, view }),
    });
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
