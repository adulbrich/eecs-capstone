import type { ReactNode } from "react";

/**
 * Consistent "no results" message for list pages: small, muted, and centered
 * as a full-width block. Render it in place of the results grid, not inside
 * it, so it centers rather than landing in the first grid cell.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 text-center text-muted-foreground text-sm">{children}</p>
  );
}
