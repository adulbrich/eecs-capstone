import { useNavigate } from "@tanstack/react-router";
import { LayoutGrid, List } from "lucide-react";

type Props =
  | {
      current: "card" | "row";
      value?: undefined;
      onChange?: undefined;
    }
  | {
      value: "card" | "row";
      onChange: (view: "card" | "row") => void;
      current?: undefined;
    };

export function ViewToggle(props: Props) {
  const navigate = useNavigate({ from: "/projects/" });
  const current = props.value ?? props.current!;

  function setMode(view: "card" | "row") {
    if (view === current) return;
    if (props.onChange) {
      props.onChange(view);
      return;
    }
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
    <div className="flex" role="group" aria-label="View mode">
      <button
        type="button"
        onClick={() => setMode("card")}
        aria-label="Card view"
        aria-pressed={current === "card"}
        className={`${base} rounded-l-md ${current === "card" ? active : inactive}`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setMode("row")}
        aria-label="Row view"
        aria-pressed={current === "row"}
        className={`${base} -ml-px rounded-r-md ${current === "row" ? active : inactive}`}
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}
