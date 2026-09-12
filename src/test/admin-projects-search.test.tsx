// @vitest-environment jsdom
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

// The route module is rewritten by the TanStack Start plugin, which injects
// its own router imports, so this partially mocks the module: only Link is
// replaced, because the column cells render links and nothing here mounts
// a router.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params: _params,
    search: _search,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    search?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { DEFAULT_ADMIN_STATUSES } from "#/lib/admin-project-filters";
import {
  resolveAdminFilter,
  searchSchema,
} from "#/routes/_authed/admin/projects/index";

describe("/admin/projects search", () => {
  it("opens on every status but archived, on Published, over all time", () => {
    const resolved = resolveAdminFilter(searchSchema.parse({}));
    expect(resolved.statuses).toEqual([...DEFAULT_ADMIN_STATUSES]);
    expect(resolved.dateField).toBe("published");
    expect(resolved).toMatchObject({ from: null, to: null });
  });

  it("opens with every switch off and carries an on switch through to the filter", () => {
    const off = resolveAdminFilter(searchSchema.parse({}));
    expect(off).toMatchObject({
      acceptingOnly: false,
      includeSoftDeleted: false,
      seekingMentorOnly: false,
      studentProposedOnly: false,
    });
    // The same param names as /projects, so a pasted link narrows here too.
    const on = resolveAdminFilter(
      searchSchema.parse({ seekingMentorOnly: true, studentProposedOnly: true })
    );
    expect(on).toMatchObject({
      acceptingOnly: false,
      seekingMentorOnly: true,
      studentProposedOnly: true,
    });
  });

  it("carries an explicit status set in full", () => {
    const parsed = searchSchema.parse({ status: ["archived"] });
    expect(parsed.status).toEqual(["archived"]);
    expect(resolveAdminFilter(parsed).statuses).toEqual(["archived"]);
  });

  it("swaps a reversed date pair rather than sending an empty range", () => {
    const resolved = resolveAdminFilter(
      searchSchema.parse({ from: "2026-07-31", to: "2026-07-01" })
    );
    expect(resolved).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("degrades a stale or hand-edited link to the default rather than erroring", () => {
    const parsed = searchSchema.parse({
      dateField: "deleted",
      from: "yesterday",
      status: "submitted",
      to: "2026-7-1",
    });
    expect(parsed.status).toBeUndefined();
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
    expect(parsed.dateField).toBe("published");
    expect(searchSchema.parse({ status: [] }).status).toBeUndefined();
  });
});
