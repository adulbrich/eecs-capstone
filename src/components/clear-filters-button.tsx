import type { ReactNode } from "react";
import { Button } from "./ui/button";

/**
 * The "Clear all" under a filter panel.
 *
 * Five panels wrote this as a `link` Button with `h-auto p-0` pasted in, and
 * the fifth had drifted to `size="sm"` (#392). The label is a prop because one
 * of the five clears a date range rather than every filter, and says so.
 *
 * Rendering is the caller's to decide: every panel shows this only while a
 * filter is on, and each counts its own active filters differently.
 */
export function ClearFiltersButton({
  children = "Clear all",
  className,
  onClick,
}: {
  children?: ReactNode;
  /** Positioning only, as UI-CONVENTIONS requires of any Button className. */
  className?: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={className}
      onClick={onClick}
      size="bare"
      type="button"
      variant="link"
    >
      {children}
    </Button>
  );
}
