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
    // Not accepting, so this row carries all three badges at once and the
    // Badges column has something to get wrong.
    acceptingApplicants: false,
    status: "published",
    studentProposed: true,
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
    // The bare row: no badge of any kind, so the cell shows a dash.
    acceptingApplicants: true,
    status: "published",
    studentProposed: false,
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

/**
 * One row's cell for one column, through the `data-label` `AdminDataTable`
 * derives from each column's header (`docs/UI-CONVENTIONS.md`). Not the
 * card-header column: that one cell carries no `data-label` on purpose, so
 * `cellFor(title, "Title")` always throws. Scoping to
 * the cell is what makes a dash assertion mean anything: a row that is
 * empty in one column is usually empty in several, so `getAllByText("-")`
 * over the row passes with the column's own dash deleted.
 */
function cellFor(title: string, label: string): HTMLElement {
  const row = screen.getByRole("link", { name: title }).closest("tr");
  const cell = row?.querySelector(`td[data-label="${label}"]`);
  if (!cell) {
    throw new Error(`no ${label} cell for ${title}`);
  }
  return cell as HTMLElement;
}

function badgesCellFor(title: string): HTMLElement {
  return cellFor(title, "Badges");
}

describe("the public project table", () => {
  it("shows the seven scannable columns and hides the prose by default", () => {
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
      "Badges",
      "Contact name",
      "Updated",
    ]);
  });

  it("shows nothing about mentorship", () => {
    // The mentor is an address staff record and never public, so no badge and
    // no column can carry it (#402). "Student proposed" used to be in this
    // assertion and is not any more: the Badges column shows it, which is the
    // point of #434.
    renderTable(DEFAULT_HIDDEN);
    const row = rowFor("Rover Telemetry");
    expect(row.queryByText(/mentor/i)).toBeNull();
    expect(row.queryByText(/@/)).toBeNull();
  });

  it("renders categories as name-only chips with the facet on hover, and a dash for none", () => {
    // The facet ("field", "technology") stays off the chip text in a table:
    // it made every chip a full line and a five-category project a five-line
    // row. The chips are already ordered by facet; the title carries it.
    renderTable(DEFAULT_HIDDEN);
    const categories = within(cellFor("Rover Telemetry", "Categories"));
    const chip = categories
      .getByText("Robotics")
      .closest('[data-slot="badge"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("Robotics");
    expect(chip?.getAttribute("title")).toBe("field");
    expect(
      categories.getByText("Web").closest('[data-slot="badge"]')
    ).not.toBeNull();
    expect(cellFor("Bare Minimum", "Categories").textContent?.trim()).toBe("-");
  });

  it("clamps prose to a fixed width and strips its markdown", () => {
    renderTable([]);
    const cell = rowFor("Rover Telemetry").getByText(
      "A bold description that goes on."
    );
    expect(cell.className).toContain("line-clamp-3");
    expect(cell.className).toContain("max-w-xs");
    expect(cell.className).toContain("md:whitespace-normal");
  });

  it("renders the card's badge row in one column, and a dash for none", () => {
    // The card's whole badge row, in the card's own words and rendered by
    // the card's own component. Two columns of "Yes" and dashes became this
    // (#434). The positives and the dash read the Badges cell, because
    // "in one column" is the claim. The negatives stay row-wide on purpose:
    // "nowhere in this row" is the stronger statement, and it is what
    // catches the cluster being rendered into some other cell.
    renderTable(DEFAULT_HIDDEN);
    const badged = within(badgesCellFor("Rover Telemetry"));
    expect(badged.getByText("Team is full")).toBeTruthy();
    expect(badged.getByText("Student proposed")).toBeTruthy();
    expect(badged.getByText("NDA/IP required")).toBeTruthy();

    const bare = rowFor("Bare Minimum");
    expect(bare.queryByText("Team is full")).toBeNull();
    expect(bare.queryByText("Student proposed")).toBeNull();
    expect(bare.queryByText("NDA/IP required")).toBeNull();
    expect(badgesCellFor("Bare Minimum").textContent?.trim()).toBe("-");
  });

  /**
   * The criterion the issue names, in the only half of it this file can
   * prove: a stale `?sort=accepting` degrades to the default order. That
   * holds by composition, and this is the half that can break here. The
   * other half, that `parseSort` drops an id outside the sortable list, is
   * pinned in `src/lib/__tests__/table-state.test.ts`.
   *
   * Calling `parseSort` here as well proved nothing: it returns the
   * `fallback` argument by reference for exactly the ids the three lines
   * below assert are unsortable, so the assertion read `expect(F)
   * .toEqual(F)` whatever `F` was.
   */
  it("keeps badges and the two removed ids out of the sortable set", () => {
    const sortableIds = PROJECT_TABLE_COLUMNS.filter(
      (column) => column.enableSorting !== false
    ).map((column) => column.id);
    expect(sortableIds).not.toContain("badges");
    expect(sortableIds).not.toContain("accepting");
    expect(sortableIds).not.toContain("nda");
  });

  /**
   * The Columns menu is built from `enableHiding !== false`, so this is what
   * stands between the criterion and a `{ ...shared.badges, enableHiding:
   * false }` copied over from `bookmark-table-columns.tsx`, where that spread
   * is correct. The bookmarks half needs no twin: that table asserts it has
   * no Columns button at all, which only holds while every column is
   * unhideable.
   */
  it("lets the Columns menu hide the badge cluster", () => {
    const hideableIds = PROJECT_TABLE_COLUMNS.filter(
      (column) => column.enableHiding !== false
    ).map((column) => column.id);
    expect(hideableIds).toContain("badges");
  });

  it("does not sort on the badge cluster", () => {
    renderTable(DEFAULT_HIDDEN);
    const header = screen
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.trim() === "Badges");
    expect(header).toBeDefined();
    // Every sortable header in this table renders its label inside a button.
    expect(within(header as HTMLElement).queryByRole("button")).toBeNull();
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

  it("bounds the Title cell and clamps the title, keeping the full text in the DOM and on the link", () => {
    renderTable(DEFAULT_HIDDEN);
    const link = screen.getByRole("link", { name: "Rover Telemetry" });
    // The clamp is CSS from `md` up, so the text itself is whole: screen
    // readers, Find-in-page and the CSV export all still see it, and the
    // native title is what a mouse user hovers for (#371).
    expect(link.textContent).toBe("Rover Telemetry");
    expect(link.getAttribute("title")).toBe("Rover Telemetry");
    expect(link.className).toContain("md:line-clamp-2");
    expect(link.className).toContain("md:whitespace-normal");
    expect(link.className).toContain("min-w-0");
    // Both bounds carry the `md:` prefix: below `md` the cell is the card
    // header strip, which must stay as wide as the card and no wider.
    expect(link.parentElement?.className).toContain("md:min-w-xs");
    expect(link.parentElement?.className).toContain("md:max-w-md");
    expect(link.parentElement?.className).not.toMatch(/(^|\s)max-w-md/);
  });
});
