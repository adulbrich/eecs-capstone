// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { server, session, toast } = vi.hoisted(() => ({
  server: {
    addBookmark: vi.fn(),
    listMyBookmarkIds: vi.fn(),
    removeBookmark: vi.fn(),
  },
  session: { data: null as null | { user: { id: string } } },
  toast: { error: vi.fn() },
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => session },
}));
vi.mock("#/server/bookmarks", () => server);
vi.mock("sonner", () => ({ toast }));
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
  BOOKMARK_TABLE_COLUMNS,
  BOOKMARK_TABLE_DEFAULT_SORT,
  type BookmarkRow,
} from "#/components/bookmark-table-columns";
import type { SortState } from "#/lib/table-state";

beforeEach(() => {
  session.data = { user: { id: "u1" } };
  // Every row on this page is a bookmark, which is what the loader returns.
  server.listMyBookmarkIds.mockResolvedValue({
    ids: ["Ten", "Two", "Three", "Four"],
  });
  server.addBookmark.mockResolvedValue({ ok: true });
  server.removeBookmark.mockResolvedValue({ ok: true });
});

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
    minQualifications: null,
    objectives: null,
    prefQualifications: null,
    problemStatement: null,
    programCourseId: null,
    programCourseName: null,
    requiresNdaIp: false,
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
  }),
  bookmark({
    id: "Three",
    teamsSupported: 3,
    bookmarkedAt: new Date("2026-04-05T00:00:00.000Z"), // Sunday
    studentProposed: true,
  }),
  bookmark({
    id: "Four",
    teamsSupported: 4,
    bookmarkedAt: new Date("2026-03-01T00:00:00.000Z"), // Sunday
    // A mentor address on file but nobody signed up at it: neither seeking
    // nor nameable, so the student-proposed fact stands alone.
    studentProposed: true,
  }),
];

function renderTable(sort: SortState = BOOKMARK_TABLE_DEFAULT_SORT) {
  return render(
    <BookmarkSetProvider>
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
    </BookmarkSetProvider>
  );
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByRole("link", { name: title }).closest("tr");
  if (!row) {
    throw new Error(`no row for ${title}`);
  }
  return row;
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
    expect(titlesInOrder()).toEqual(["Ten", "Two", "Three", "Four"]);
  });

  it("sorts Saved on chronologically, not as text", () => {
    // Alphabetical on Date strings would start with Mon (Ten), not March.
    renderTable({ desc: false, id: "savedAt" });
    expect(titlesInOrder()).toEqual(["Four", "Three", "Two", "Ten"]);
  });

  it("sorts Teams supported numerically, not as text", () => {
    // Text would put "10" before "2".
    renderTable({ desc: false, id: "teams" });
    expect(titlesInOrder()).toEqual(["Two", "Three", "Four", "Ten"]);
  });

  it("shows the fixed column set with no column picker", () => {
    renderTable();
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    ).toEqual([
      "Title",
      "Program",
      "Status",
      "Openings",
      "Teams supported",
      "NDA/IP required",
      "Saved on",
    ]);
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
  });

  it("shows neither badge: the card and the page carry them, the table does not", () => {
    // #336 took the Origin column out with the public table's Mentorship
    // column, so a saved project's marks are read on its card or its page.
    renderTable();
    const two = screen.getByRole("link", { name: "Two" }).closest("tr");
    if (!two) {
      throw new Error("no row");
    }
    expect(within(two).queryByText("Student proposed")).toBeNull();
    expect(within(two).queryByText(/mentor/i)).toBeNull();
  });

  it("bounds the Title cell and clamps the title, keeping the full text on the link", () => {
    renderTable();
    const link = screen.getByRole("link", { name: "Two" });
    expect(link.getAttribute("title")).toBe("Two");
    expect(link.className).toContain("md:line-clamp-2");
    expect(link.className).toContain("md:whitespace-normal");
    expect(link.className).toContain("min-w-0");
    expect(link.parentElement?.className).toContain("md:min-w-xs");
    expect(link.parentElement?.className).toContain("md:max-w-md");
  });

  it("marks a closed roster and an NDA", () => {
    renderTable();
    expect(within(rowFor("Two")).getByText("Team is full")).toBeTruthy();
    expect(within(rowFor("Two")).getByText("Required")).toBeTruthy();
  });

  it("puts the listing's toggle in the Title cell, with no Remove column", async () => {
    renderTable();
    await waitFor(() =>
      expect(
        within(rowFor("Two")).getByRole("button", { name: "Remove bookmark" })
      ).toBeTruthy()
    );
    // Right-aligned inside the Title cell, the same place /projects table mode
    // puts it, rather than a column of its own.
    const toggle = within(rowFor("Two")).getByRole("button", {
      name: "Remove bookmark",
    });
    expect(toggle.className).toContain("ml-auto");
    expect(toggle.closest("td")).toBe(
      screen.getByRole("link", { name: "Two" }).closest("td")
    );
    expect(
      screen.queryByRole("button", { name: /^Remove .* from bookmarks$/ })
    ).toBeNull();
  });

  it("leaves the row in place after an un-bookmark, showing the toggle unset", async () => {
    // The point of the change: a toggle that deletes its own row can never
    // show its unset state, so it is not a toggle. The loader still returns
    // bookmarks, so the row goes on the next load, not on the click.
    renderTable();
    const toggle = () =>
      within(rowFor("Two")).getByRole("button", {
        name: /^(Bookmark|Remove bookmark)$/,
      });
    await waitFor(() =>
      expect(toggle().getAttribute("aria-label")).toBe("Remove bookmark")
    );

    fireEvent.click(toggle());
    await waitFor(() =>
      expect(server.removeBookmark).toHaveBeenCalledWith({
        data: { projectId: "Two" },
      })
    );
    expect(titlesInOrder()).toEqual(["Ten", "Two", "Three", "Four"]);
    await waitFor(() =>
      expect(toggle().getAttribute("aria-label")).toBe("Bookmark")
    );

    // And clicking again puts it back, which the Remove button could not do.
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(server.addBookmark).toHaveBeenCalledWith({
        data: { projectId: "Two" },
      })
    );
    await waitFor(() =>
      expect(toggle().getAttribute("aria-label")).toBe("Remove bookmark")
    );
  });

  it("reverts the toggle and raises a toast when the write fails", async () => {
    server.removeBookmark.mockRejectedValue(new Error("Nope"));
    renderTable();
    const toggle = () =>
      within(rowFor("Two")).getByRole("button", {
        name: /^(Bookmark|Remove bookmark)$/,
      });
    await waitFor(() =>
      expect(toggle().getAttribute("aria-label")).toBe("Remove bookmark")
    );

    fireEvent.click(toggle());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
    expect(toggle().getAttribute("aria-label")).toBe("Remove bookmark");
    expect(titlesInOrder()).toEqual(["Ten", "Two", "Three", "Four"]);
  });
});
