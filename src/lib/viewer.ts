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
 *
 * `isAdmin` and `assertAdmin` answer the narrower question, and joined them
 * here for the same reason one layer out: seventeen sites under
 * `src/routes/_authed/` spelled a role comparison out rather than asking
 * either predicate, and `assertAdmin` had a private copy in
 * `_internal/users.ts` (#266).
 *
 * The roles themselves are not declared here. `USER_ROLES` in
 * `vocabularies.ts` is the whole list, and this module holds the questions
 * asked about it (#274).
 */

import type { UserRole } from "./vocabularies";

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

/**
 * The roles that carry staff powers. Anything else fails closed.
 *
 * Exported as a tuple rather than kept private as a `Set`, because one caller
 * cannot use the predicate: `listEligibleInstructorsAs` in `_internal/programs.ts`
 * filters the `user.role` column with `inArray`, and a question asked in SQL
 * needs the roles as data. That is the same shape as the status vocabularies
 * in `vocabularies.ts` and has the same rule: this is the one definition, and
 * a second copy of the list is the bug (#266).
 *
 * The `satisfies` clause holds it to `USER_ROLES` without deriving it: which
 * roles carry staff powers is a judgement, and a role added there is one
 * somebody has to decide about rather than one that joins this list on its
 * own. What it buys is that a role renamed in the vocabulary fails to compile
 * here rather than quietly stripping every instructor of staff powers.
 */
export const STAFF_ROLES = [
  "admin",
  "instructor",
] as const satisfies readonly UserRole[];

export function isStaff(viewer: Viewer): boolean {
  return (
    !!viewer && (STAFF_ROLES as readonly string[]).includes(viewer.role ?? "")
  );
}

/**
 * Admin, which is a strictly narrower question than staff.
 *
 * User administration asks this one: an instructor is staff and must not
 * reach `/admin/users`. Keeping it here rather than leaving those two routes
 * to compare the string themselves is the point of #266. Widening either of
 * them to `isStaff` hands instructors the ability to change roles and ban
 * accounts, so the two predicates are deliberately not interchangeable and
 * neither is defined in terms of the other.
 *
 */
export function isAdmin(viewer: Viewer): boolean {
  return !!viewer && viewer.role === "admin";
}

/**
 * The admin gate, throwing rather than returning, and the same shape as
 * `assertStaff` for the same reason: six seams in `src/server/_internal/`
 * read `viewer.id` right after asking, so the narrowing carries.
 *
 * This was a hand-rolled comparison private to `_internal/users.ts`, with
 * six call sites. It moved here rather than staying there for the reason the
 * header gives: the routes ask the same question now, and a predicate with
 * two homes is the thing #266 exists to remove.
 */
export function assertAdmin(
  viewer: Viewer
): asserts viewer is NonNullable<Viewer> {
  if (!isAdmin(viewer)) {
    throw new Error("Forbidden");
  }
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
