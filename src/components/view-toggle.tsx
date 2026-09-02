import { useNavigate } from "@tanstack/react-router";
import { LayoutGrid, Table } from "lucide-react";
import { type ViewMode, writeStoredView } from "#/lib/view-preference";

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

  const base =
    "flex h-9 items-center border border-border px-2.5 transition-colors";
  const active = "bg-secondary";
  const inactive = "hover:bg-secondary";

  return (
    // biome-ignore lint/a11y/useSemanticElements: aria role=group with label is the right pattern for paired toggle buttons
    <div aria-label="View mode" className="flex" role="group">
      <button
        aria-label="Card view"
        aria-pressed={current === "card"}
        className={`${base} rounded-l-md ${current === "card" ? active : inactive}`}
        onClick={() => setMode("card")}
        type="button"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        aria-label="Table view"
        aria-pressed={current === "table"}
        className={`${base} -ml-px rounded-r-md ${current === "table" ? active : inactive}`}
        onClick={() => setMode("table")}
        type="button"
      >
        <Table className="h-4 w-4" />
      </button>
    </div>
  );
}
