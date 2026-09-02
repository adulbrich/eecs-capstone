// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { router, server } = vi.hoisted(() => ({
  router: { invalidate: vi.fn(() => Promise.resolve()) },
  server: { removeBookmark: vi.fn(() => Promise.resolve({ ok: true })) },
}));

vi.mock("#/server/bookmarks", () => server);
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
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
  useRouter: () => router,
}));

import { AdminDataTable } from "#/components/admin-data-table";
import {
  BOOKMARK_TABLE_COLUMNS,
  BOOKMARK_TABLE_DEFAULT_SORT,
  type BookmarkRow,
} from "#/components/bookmark-table-columns";
import type { SortState } from "#/lib/table-state";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function bookmark(
  overrides: Partial<BookmarkRow> & { id: string }
): BookmarkRow {
  return {
    acceptingApplicants: true,
    categories: [],
    contactEmail: null,
    contactName: null,
    description: null,
    imageUrl: null,
    licenseRestrictions: null,
    mentorName: null,
    minQualifications: null,
    objectives: null,
    prefQualifications: null,
    problemStatement: null,
    programCourseId: null,
    programCourseName: null,
    requiresNdaIp: false,
    seekingMentor: false,
    status: "published",
    studentProposed: false,
    teamsSupported: 1,
    title: overrides.id,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    url: null,
    // Weekdays chosen so alphabetical order (Mon, Sat, Sun) disagrees with
    // chronological order: a text sort on Date strings would show here.
    bookmarkedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  } as BookmarkRow;
}

const ROWS: BookmarkRow[] = [
  bookmark({
    id: "Ten",
    teamsSupported: 10,
    bookmarkedAt: new Date("2026-06-01T00:00:00.000Z"), // Monday
  }),
  bookmark({
    id: "Two",
    teamsSupported: 2,
    bookmarkedAt: new Date("2026-05-02T00:00:00.000Z"), // Saturday
    acceptingApplicants: false,
    requiresNdaIp: true,
    studentProposed: true,
    seekingMentor: true,
  }),
  bookmark({
    id: "Three",
    teamsSupported: 3,
    bookmarkedAt: new Date("2026-04-05T00:00:00.000Z"), // Sunday
    studentProposed: true,
    mentorName: "Sam Mentor",
  }),
];

function renderTable(sort: SortState = BOOKMARK_TABLE_DEFAULT_SORT) {
  return render(
    <AdminDataTable
      caption="My bookmarks"
      columns={BOOKMARK_TABLE_COLUMNS}
      data={ROWS}
      defaultSort={BOOKMARK_TABLE_DEFAULT_SORT}
      emptyMessage="Nothing."
      getRowId={(row) => row.id}
      hidden={[]}
      onHiddenChange={() => {
        // controlled by the route in production
      }}
      onSortChange={() => {
        // controlled by the route in production
      }}
      sort={sort}
      storageKey="test"
    />
  );
}

function titlesInOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("link").textContent ?? "");
}

describe("the bookmarks table", () => {
  it("opens sorted by Saved on, newest first", () => {
    expect(BOOKMARK_TABLE_DEFAULT_SORT).toEqual({ desc: true, id: "savedAt" });
    renderTable();
    expect(titlesInOrder()).toEqual(["Ten", "Two", "Three"]);
  });

  it("sorts Saved on chronologically, not as text", () => {
    // Alphabetical on Date strings would give Sun, Sat, Mon: Three, Two, Ten.
    renderTable({ desc: false, id: "savedAt" });
    expect(titlesInOrder()).toEqual(["Three", "Two", "Ten"]);
  });

  it("sorts Teams supported numerically, not as text", () => {
    // Text would put "10" before "2".
    renderTable({ desc: false, id: "teams" });
    expect(titlesInOrder()).toEqual(["Two", "Three", "Ten"]);
  });

  it("shows the fixed column set with no column picker", () => {
    renderTable();
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    ).toEqual([
      "Title",
      "Program",
      "Status",
      "Accepting applicants",
      "Teams supported",
      "NDA/IP required",
      "Origin",
      "Saved on",
      "Remove",
    ]);
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
  });

  it("carries both mentorship facts in one Origin cell", () => {
    renderTable();
    const two = screen.getByRole("link", { name: "Two" }).closest("tr");
    const three = screen.getByRole("link", { name: "Three" }).closest("tr");
    const ten = screen.getByRole("link", { name: "Ten" }).closest("tr");
    if (!(two && three && ten)) {
      throw new Error("no row");
    }
    expect(within(two).getByText("Student proposed")).toBeTruthy();
    expect(within(two).getByText("Seeking mentor")).toBeTruthy();
    expect(within(three).getByText("Student proposed")).toBeTruthy();
    expect(within(three).getByText("Sam Mentor")).toBeTruthy();
    expect(within(ten).queryByText("Student proposed")).toBeNull();
  });

  it("marks a closed roster and an NDA, and removes through the loader", async () => {
    renderTable();
    const two = screen.getByRole("link", { name: "Two" }).closest("tr");
    if (!two) {
      throw new Error("no row");
    }
    expect(within(two).getByText("Not accepting applicants")).toBeTruthy();
    expect(within(two).getByText("Required")).toBeTruthy();
    within(two)
      .getByRole("button", { name: "Remove Two from bookmarks" })
      .click();
    await vi.waitFor(() => expect(router.invalidate).toHaveBeenCalled());
    expect(server.removeBookmark).toHaveBeenCalledWith({
      data: { projectId: "Two" },
    });
  });
});
