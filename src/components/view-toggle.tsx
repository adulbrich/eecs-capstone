import { LayoutGrid, Table } from "lucide-react";
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
    // The segmented look comes from the wrapper, so neither Button sets a
    // radius, and the pressed fill comes from `aria-pressed` in the Button
    // base class, so neither sets a colour (UI-CONVENTIONS, "`className` on a
    // Button never restyles it").
    // biome-ignore lint/a11y/useSemanticElements: aria role=group with label is the right pattern for paired toggle buttons
    <div
      aria-label="View mode"
      className="flex [&>*+*]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none"
      role="group"
    >
      <Button
        aria-label="Card view"
        aria-pressed={current === "card"}
        onClick={() => setMode("card")}
        size="icon"
        type="button"
        variant="outline"
      >
        <LayoutGrid />
      </Button>
      <Button
        aria-label="Table view"
        aria-pressed={current === "table"}
        onClick={() => setMode("table")}
        size="icon"
        type="button"
        variant="outline"
      >
        <Table />
      </Button>
    </div>
  );
}
