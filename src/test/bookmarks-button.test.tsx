// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let session: { user: { id: string } } | null = null;
let bookmarked = ["a", "b"];

vi.mock("#/server/bookmarks", () => ({
  addBookmark: ({ data }: { data: { projectId: string } }) => {
    bookmarked = [...bookmarked, data.projectId];
    return Promise.resolve({ ok: true });
  },
  listMyBookmarkIds: () => Promise.resolve({ ids: bookmarked }),
  listMyBookmarks: () =>
    Promise.resolve({ rows: bookmarked.map((id) => ({ id })) }),
  removeBookmark: ({ data }: { data: { projectId: string } }) => {
    bookmarked = bookmarked.filter((id) => id !== data.projectId);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

// An href, so the anchor has the link role the queries below look for.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: { children: React.ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { BookmarkSetProvider, BookmarkToggle } from "#/components/bookmark-set";
import { BookmarksButton } from "#/components/bookmarks-button";

afterEach(() => {
  cleanup();
  session = null;
  bookmarked = ["a", "b"];
});

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("BookmarksButton", () => {
  it("renders nothing for an anonymous viewer", async () => {
    const { queryByRole, findByText } = renderWith(
      <>
        <BookmarksButton />
        <span>sentinel</span>
      </>
    );
    await findByText("sentinel");
    expect(queryByRole("link", { name: /Bookmarks/ })).toBeNull();
  });

  it("links to /my/bookmarks with the count of visible bookmarks", async () => {
    session = { user: { id: "u1" } };
    const { findByRole } = renderWith(<BookmarksButton />);
    const link = await findByRole("link", { name: "Bookmarks 2" });
    expect(link.getAttribute("href")).toBe("/my/bookmarks");
  });

  it("updates without a reload when a row's toggle is clicked", async () => {
    // The toggles and the count sit on the same page, so a click has to reach
    // the count with no remount: the shared writer invalidates ["bookmarks"].
    session = { user: { id: "u1" } };
    const { findByRole } = renderWith(
      <>
        <BookmarksButton />
        <BookmarkSetProvider>
          <BookmarkToggle projectId="c" />
        </BookmarkSetProvider>
      </>
    );
    await findByRole("link", { name: "Bookmarks 2" });
    fireEvent.click(await findByRole("button", { name: "Bookmark" }));
    await findByRole("button", { name: "Remove bookmark" });
    expect(await findByRole("link", { name: "Bookmarks 3" })).toBeTruthy();
  });
});
