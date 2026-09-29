import { isAdmin, isStaff, type Viewer } from "./viewer";

/**
 * Refusing a signed-in viewer who lacks the role for a page, in place (#606).
 *
 * The staff routes used to redirect such a viewer to `/` or `/admin` without
 * saying why. Now a guard throws an `AccessDenied`, the router's default error
 * component renders the access-denied page at the URL they asked for, and
 * `src/server.ts` answers 403 for it. The repo is public, so the page does not
 * pretend the admin routes are missing.
 *
 * A plain object rather than an `Error` subclass, the way `notFound()` is. A
 * server render dehydrates a thrown `Error` as `new Error(message)` and drops
 * every other field, so a subclass would reach the browser as an ordinary
 * error and the page would hydrate into the generic one. A plain object
 * crosses intact, and `isAccessDenied` recognises it on both sides.
 *
 * These guards are navigation UX. Every server function still enforces its
 * own access level (ADR-0003).
 */

/** The role a refused page needs, as the page words it. */
export type RequiredRole = "staff" | "admin";

export interface AccessDenied {
  accessDenied: true;
  /** The viewer's own address, which they can already see on `/profile`. */
  email: string;
  requires: RequiredRole;
}

/** The signed-in user `_authed` puts in route context. */
type SignedIn = NonNullable<Viewer> & { email: string };

export function isAccessDenied(value: unknown): value is AccessDenied {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AccessDenied>;
  return (
    candidate.accessDenied === true &&
    (candidate.requires === "staff" || candidate.requires === "admin") &&
    typeof candidate.email === "string"
  );
}

function refuse(user: SignedIn, requires: RequiredRole): never {
  const denied: AccessDenied = {
    accessDenied: true,
    requires,
    email: user.email,
  };
  throw denied;
}

/** For a route's `beforeLoad`: lets staff through, refuses anyone else. */
export function requireStaff(user: SignedIn): void {
  if (!isStaff(user)) {
    refuse(user, "staff");
  }
}

/** For a route's `beforeLoad`: lets admins through, refuses anyone else. */
export function requireAdmin(user: SignedIn): void {
  if (!isAdmin(user)) {
    refuse(user, "admin");
  }
}
