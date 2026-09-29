// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAccessDenied } from "#/lib/access-denied";
import { USER_ROLES } from "#/lib/vocabularies";
import { Route as adminLayout } from "#/routes/_authed/admin";
import { Route as analytics } from "#/routes/_authed/admin/analytics";
import { Route as categoryEdit } from "#/routes/_authed/admin/categories/$categoryId";
import { Route as categories } from "#/routes/_authed/admin/categories/index";
import { Route as adminHome } from "#/routes/_authed/admin/index";
import { Route as inventory } from "#/routes/_authed/admin/inventory/index";
import { Route as requests } from "#/routes/_authed/admin/inventory/requests";
import { Route as mentors } from "#/routes/_authed/admin/mentors/index";
import { Route as placement } from "#/routes/_authed/admin/placement";
import { Route as programEdit } from "#/routes/_authed/admin/programs/$programId";
import { Route as programs } from "#/routes/_authed/admin/programs/index";
import { Route as projects } from "#/routes/_authed/admin/projects/index";
import { Route as traffic } from "#/routes/_authed/admin/traffic";
import { Route as userDetail } from "#/routes/_authed/admin/users/$userId";
import { Route as users } from "#/routes/_authed/admin/users/index";
import { Route as itemEdit } from "#/routes/_authed/inventory/$itemId/edit";
import { Route as itemNew } from "#/routes/_authed/inventory/new";

/**
 * The guards below `_authed` ask about `context.user`, the user `_authed`
 * read once for the load, instead of reading the session again (#633).
 * The browser suites reach them only through a server render (`page.goto`),
 * so this runs each one directly, which is also the path a client navigation
 * takes, and pins which roles each lets through.
 *
 * A viewer without the role is refused where they stand, with the role the
 * page needs, rather than redirected (#606).
 */

type Guard = (options: { context: { user: unknown } }) => unknown;

const EMAIL = "someone@example.com";

function guardOf(route: { options: unknown }): Guard {
  return (route.options as { beforeLoad: Guard }).beforeLoad;
}

/** The role the guard says is missing, or null when it lets the viewer in. */
function refusalOf(guard: Guard, role: string): string | null {
  try {
    guard({ context: { user: { id: "u1", role, email: EMAIL } } });
    return null;
  } catch (thrown) {
    if (isAccessDenied(thrown)) {
      expect(thrown.email).toBe(EMAIL);
      return thrown.requires;
    }
    throw thrown;
  }
}

const STAFF_GATED = {
  "/_authed/admin": adminLayout,
  "/_authed/admin/": adminHome,
  "/_authed/admin/analytics": analytics,
  "/_authed/admin/categories/": categories,
  "/_authed/admin/categories/$categoryId": categoryEdit,
  "/_authed/admin/inventory/": inventory,
  "/_authed/admin/inventory/requests": requests,
  "/_authed/admin/mentors/": mentors,
  "/_authed/admin/placement": placement,
  "/_authed/admin/programs/": programs,
  "/_authed/admin/programs/$programId": programEdit,
  "/_authed/admin/projects/": projects,
  "/_authed/admin/traffic": traffic,
  "/_authed/inventory/$itemId/edit": itemEdit,
  "/_authed/inventory/new": itemNew,
};

const ADMIN_GATED = {
  "/_authed/admin/users/": users,
  "/_authed/admin/users/$userId": userDetail,
};

const ROUTES_DIR = join(process.cwd(), "src/routes/_authed");

/** A hand-written role check in a guard, which is where a redirect hid. */
const ROLE_CHECK = /if \(!is(Staff|Admin)\(/;
const ROLE_GUARD = /require(Staff|Admin)\(context\.user\)/;

function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".tsx") || file.endsWith(".ts")
  );
}

function sourceOf(file: string): string {
  return readFileSync(join(ROUTES_DIR, file), "utf8");
}

// "/_authed/admin/" is admin/index.tsx; "/_authed/admin" is admin.tsx.
function fileOf(id: string): string {
  const path = id.replace("/_authed/", "");
  return `${path.endsWith("/") ? `${path}index` : path}.tsx`;
}

describe("route guards below _authed", () => {
  for (const [id, route] of Object.entries(STAFF_GATED)) {
    it(`${id} admits staff and refuses anyone else`, () => {
      const guard = guardOf(route);
      expect(refusalOf(guard, "user")).toBe("staff");
      expect(refusalOf(guard, "instructor")).toBeNull();
      expect(refusalOf(guard, "admin")).toBeNull();
    });
  }

  for (const [id, route] of Object.entries(ADMIN_GATED)) {
    it(`${id} admits admins and refuses anyone else`, () => {
      const guard = guardOf(route);
      // In the app a plain user never reaches this guard: the admin layout
      // above it refuses them first, as lacking staff. Alone, it says admin.
      expect(refusalOf(guard, "user")).toBe("admin");
      expect(refusalOf(guard, "instructor")).toBe("admin");
      expect(refusalOf(guard, "admin")).toBeNull();
    });
  }

  it("hands the user detail page its actor from context", () => {
    const guard = guardOf(userDetail);
    expect(
      guard({ context: { user: { id: "a1", role: "admin", email: EMAIL } } })
    ).toEqual({
      actorId: "a1",
    });
  });

  it("covers every role there is", () => {
    // A role added to the vocabulary has to be decided for every guard here.
    expect([...USER_ROLES].sort()).toEqual(["admin", "instructor", "user"]);
  });

  it("covers every guarded route below _authed.tsx", () => {
    const tested = [...Object.keys(STAFF_GATED), ...Object.keys(ADMIN_GATED)]
      .map(fileOf)
      .sort();
    expect(
      routeFiles()
        .filter((file) => sourceOf(file).includes("beforeLoad"))
        .sort()
    ).toEqual(tested);
  });

  it("redirects nobody below _authed.tsx for lacking a role", () => {
    // A role guard that redirects hides why the page did not open (#606).
    // `requireStaff` and `requireAdmin` refuse in place instead. Redirects
    // that are not about a role, such as the project edit page sending a
    // viewer who cannot edit back to the project, do not mention either.
    const guarded = routeFiles().filter((file) =>
      sourceOf(file).includes("beforeLoad")
    );
    for (const file of guarded) {
      const source = sourceOf(file);
      expect(source, file).not.toMatch(ROLE_CHECK);
      expect(source, file).toMatch(ROLE_GUARD);
    }
  });

  it("reads the session nowhere below _authed.tsx", () => {
    // The module path, not the call or one spelling of the import, so a
    // renamed binding, the `#/` or `@/` alias and a relative path all count.
    expect(
      routeFiles().filter((file) => sourceOf(file).includes("lib/auth-guards"))
    ).toEqual([]);
  });
});
