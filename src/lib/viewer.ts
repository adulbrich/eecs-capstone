/**
 * The role questions, for every domain.
 *
 * `isStaff` used to live in `src/lib/project-visibility.ts`, where ten files
 * across seven non-project domains imported it: categories, programs, users,
 * comments, uploads, admin and bookmarks. A domain module owning something
 * that is not domain-specific is what made that module's name wrong, so the
 * shared thing moved out rather than the module's name getting broader.
 *
 * `assertStaff` had five hand-rolled definitions before this: inventory,
 * inventory-transitions, programs, categories and users. Three wrapped
 * `isStaff`, two inlined the role comparison.
 */

/**
 * Anyone a permission question can be asked about. Nullable because an
 * anonymous request is a real viewer with no account, not a missing argument.
 */
export type Viewer =
  | {
      id: string;
      role?: string | null | undefined;
    }
  | null
  | undefined;

/** The roles that carry staff powers. Anything else fails closed. */
const STAFF_ROLES = new Set(["admin", "instructor"]);

export function isStaff(viewer: Viewer): boolean {
  return !!viewer && STAFF_ROLES.has(viewer.role ?? "");
}

/**
 * The staff gate, throwing rather than returning.
 *
 * The `asserts` signature is load-bearing rather than decorative: call sites
 * read `viewer.id` immediately afterwards without a second null check, so
 * narrowing here is what keeps them honest.
 */
export function assertStaff(
  viewer: Viewer
): asserts viewer is NonNullable<Viewer> {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
}
