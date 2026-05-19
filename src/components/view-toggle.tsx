import { LayoutGrid, List } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

type Props = {
  current: "card" | "row";
};

export function ViewToggle({ current }: Props) {
  const navigate = useNavigate({ from: "/projects/" });

  function setMode(view: "card" | "row") {
    if (view === current) return;
    void navigate({
      search: (prev) => ({ ...prev, view }),
    });
  }

  const base = "border border-neutral-300 p-1.5 dark:border-neutral-700";
  const active = "bg-neutral-200 dark:bg-neutral-800";
  const inactive = "hover:bg-neutral-100 dark:hover:bg-neutral-900";

  return (
    // biome-ignore lint/a11y/useSemanticElements: aria role=group with label is the right pattern for paired toggle buttons
    <div className="flex" role="group" aria-label="View mode">
      <button
        type="button"
        onClick={() => setMode("card")}
        aria-label="Card view"
        aria-pressed={current === "card"}
        className={`${base} ${current === "card" ? active : inactive}`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setMode("row")}
        aria-label="Row view"
        aria-pressed={current === "row"}
        className={`${base} -ml-px ${current === "row" ? active : inactive}`}
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}
