// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { server, session } = vi.hoisted(() => ({
  server: {
    addBookmark: vi.fn(),
    listMyBookmarkIds: vi.fn(() => Promise.resolve({ ids: ["p1"] })),
    removeBookmark: vi.fn(),
  },
  session: { data: { user: { id: "u1" } } },
}));
vi.mock("#/server/bookmarks", () => server);
vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => session },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminDataTable } from "#/components/admin-data-table";
import { BookmarkSetProvider } from "#/components/bookmark-set";
import {
  PROJECT_TABLE_COLUMNS,
  PROJECT_TABLE_DEFAULT_SORT,
  type ProjectListRow,
} from "#/components/project-table-columns";

afterEach(cleanup);

const ROWS: ProjectListRow[] = [
  {
    categories: [
      { id: "c1", name: "Robotics", type: "field" },
      { id: "c2", name: "Web", type: "field" },
    ],
    contactEmail: "jane@example.com",
    contactName: "Jane Doe",
    description: "A **bold** description that goes on.",
    id: "p1",
    imageUrl: "projects/p1/a.webp",
    licenseRestrictions: "OSU owns it",
    minQualifications: null,
    objectives: null,
    prefQualifications: null,
    problemStatement: null,
    programCourseId: "CS 461",
    programCourseName: "Capstone",
    requiresNdaIp: true,
    status: "published",
    teamsSupported: 3,
    title: "Rover Telemetry",
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    url: "https://example.com/rover",
  },
  {
    categories: [],
    contactEmail: null,
    contactName: null,
    description: null,
    id: "p2",
    imageUrl: null,
    licenseRestrictions: null,
    minQualifications: null,
    objectives: null,
    prefQualifications: null,
    problemStatement: null,
    programCourseId: null,
    programCourseName: null,
    requiresNdaIp: false,
    status: "published",
    teamsSupported: 1,
    title: "Bare Minimum",
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    url: null,
  },
];

const DEFAULT_HIDDEN = PROJECT_TABLE_COLUMNS.filter(
  (column) => column.defaultHidden
).map((column) => column.id);

function renderTable(hidden: string[]) {
  return render(
    <BookmarkSetProvider>
      <AdminDataTable
        caption="Projects"
        columns={PROJECT_TABLE_COLUMNS}
        data={ROWS}
        defaultSort={PROJECT_TABLE_DEFAULT_SORT}
        emptyMessage="Nothing."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={() => {
          // controlled by the route in production
        }}
        onSortChange={() => {
          // controlled by the route in production
        }}
        sort={PROJECT_TABLE_DEFAULT_SORT}
        storageKey="test"
      />
    </BookmarkSetProvider>
  );
}

function rowFor(title: string) {
  const link = screen.getByRole("link", { name: title });
  const row = link.closest("tr");
  if (!row) {
    throw new Error(`no row for ${title}`);
  }
  return within(row);
}

describe("the public project table", () => {
  it("shows the eight scannable columns and hides the prose by default", () => {
    // The literal lists come from the issue's column table, not from the
    // module, so a column added on the wrong side of the line fails here.
    expect([...DEFAULT_HIDDEN].sort()).toEqual([
      "contactEmail",
      "description",
      "licenseRestrictions",
      "minQualifications",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "url",
    ]);
    renderTable(DEFAULT_HIDDEN);
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    ).toEqual([
      "Title",
      "Program",
      "Categories",
      "Teams supported",
      "NDA/IP required",
      "Contact name",
      "Updated",
    ]);
  });

  it("renders categories as chips, and a dash for none", () => {
    renderTable(DEFAULT_HIDDEN);
    const row = rowFor("Rover Telemetry");
    expect(
      row.getByText("Robotics").closest('[data-slot="badge"]')
    ).not.toBeNull();
    expect(row.getByText("Web").closest('[data-slot="badge"]')).not.toBeNull();
    expect(rowFor("Bare Minimum").getAllByText("-").length).toBeGreaterThan(0);
  });

  it("clamps prose to a fixed width and strips its markdown", () => {
    renderTable([]);
    const cell = rowFor("Rover Telemetry").getByText(
      "A bold description that goes on."
    );
    expect(cell.className).toContain("line-clamp-3");
    expect(cell.className).toContain("max-w-xs");
  });

  it("renders the NDA flag as a badge and its absence as a dash", () => {
    renderTable(DEFAULT_HIDDEN);
    expect(rowFor("Rover Telemetry").getByText("Required")).toBeTruthy();
    const bare = rowFor("Bare Minimum");
    expect(bare.queryByText("Required")).toBeNull();
    expect(bare.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("renders the contact email as a mailto link and the URL as an external link", () => {
    renderTable([]);
    const row = rowFor("Rover Telemetry");
    expect(
      row.getByRole("link", { name: "jane@example.com" }).getAttribute("href")
    ).toBe("mailto:jane@example.com");
    const url = row.getByRole("link", { name: "https://example.com/rover" });
    expect(url.getAttribute("href")).toBe("https://example.com/rover");
    expect(url.getAttribute("rel")).toContain("noreferrer");
  });

  it("puts the thumbnail, the link and the bookmark toggle in the Title cell", async () => {
    renderTable(DEFAULT_HIDDEN);
    const title = screen
      .getByRole("link", { name: "Rover Telemetry" })
      .closest("td");
    if (!title) {
      throw new Error("no title cell");
    }
    // The card-header attribute is what makes this cell the mobile card's
    // title strip; the thumbnail and the toggle ride inside it rather than
    // taking columns of their own.
    expect(title.getAttribute("data-card-header")).not.toBeNull();
    expect(title.querySelector("img")?.getAttribute("src")).toContain(
      "projects/p1/a.webp"
    );
    const toggle = await within(title).findByRole("button", {
      name: "Remove bookmark",
    });
    expect(toggle.closest("a")).toBeNull();
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    ).not.toContain("Bookmark");
  });
});
