export type ViewMode = "card" | "table";

/**
 * localStorage key for the listing view mode. Read by `/projects` today; the
 * public inventory listing will read the same key once it has a table mode.
 */
export const VIEW_STORAGE_KEY = "cs-capstone:view-mode";

/**
 * `row` was a valid value until 2026-09-02, when the table mode replaced it.
 * It is dropped, not aliased: a browser still holding it reads as "no
 * preference" and falls back to the default once.
 */
function isViewMode(value: unknown): value is ViewMode {
  return value === "card" || value === "table";
}

/**
 * Reads the persisted view preference. Returns null when running without a
 * DOM (SSR), when nothing is stored, or when the stored value is not a valid
 * view mode. Never throws.
 */
export function readStoredView(): ViewMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return isViewMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Persists the view preference. A no-op (never throws) when storage is
 * unavailable.
 */
export function writeStoredView(view: ViewMode): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore: storage may be full or disabled (private mode).
  }
}
