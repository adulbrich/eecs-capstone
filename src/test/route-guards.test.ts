// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { USER_ROLES } from "#/lib/vocabularies";
import { Route as adminLayout } from "#/routes/_authed/admin";
import { Route as analytics } from "#/routes/_authed/admin/analytics";
import { Route as categoryEdit } from "#/routes/_authed/admin/categories/$categoryId";
import { Route as categories } from "#/routes/_authed/admin/categories/index";
import { Route as adminHome } from "#/routes/_authed/admin/index";
import { Route as inventory } from "#/routes/_authed/admin/inventory/index";
import { Route as requests } from "#/routes/_authed/admin/inventory/requests";
import { Route as mentors } from "#/routes/_authed/admin/mentors/index";
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
 */

type Guard = (options: { context: { user: unknown } }) => unknown;

function guardOf(route: { options: unknown }): Guard {
  return (route.options as { beforeLoad: Guard }).beforeLoad;
}

function redirectOf(guard: Guard, role: string): string | null {
  try {
    guard({ context: { user: { id: "u1", role } } });
    return null;
  } catch (thrown) {
    if (isRedirect(thrown)) {
      return String(thrown.options.to);
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
    it(`${id} admits staff and sends anyone else home`, () => {
      const guard = guardOf(route);
      expect(redirectOf(guard, "user")).toBe("/");
      expect(redirectOf(guard, "instructor")).toBeNull();
      expect(redirectOf(guard, "admin")).toBeNull();
    });
  }

  for (const [id, route] of Object.entries(ADMIN_GATED)) {
    it(`${id} admits admins and sends anyone else back to /admin`, () => {
      const guard = guardOf(route);
      expect(redirectOf(guard, "user")).toBe("/admin");
      expect(redirectOf(guard, "instructor")).toBe("/admin");
      expect(redirectOf(guard, "admin")).toBeNull();
    });
  }

  it("hands the user detail page its actor from context", () => {
    const guard = guardOf(userDetail);
    expect(guard({ context: { user: { id: "a1", role: "admin" } } })).toEqual({
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

  it("reads the session nowhere below _authed.tsx", () => {
    // The module path, not the call or one spelling of the import, so a
    // renamed binding, the `#/` or `@/` alias and a relative path all count.
    expect(
      routeFiles().filter((file) => sourceOf(file).includes("lib/auth-guards"))
    ).toEqual([]);
  });
});
