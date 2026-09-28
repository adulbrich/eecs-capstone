// @vitest-environment jsdom
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type * as React from "react";
import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let session: { user: { id: string } } | null = null;
let bookmarked = ["a", "b"];

vi.mock("#/server/bookmarks", () => ({
  addBookmark: ({ data }: { data: { projectId: string } }) => {
    bookmarked = [...bookmarked, data.projectId];
    return Promise.resolve({ ok: true });
  },
  listMyBookmarkIds: () => Promise.resolve({ ids: bookmarked }),
  listMyBookmarks: vi.fn(() =>
    Promise.resolve({ rows: bookmarked.map((id) => ({ id })) })
  ),
  removeBookmark: ({ data }: { data: { projectId: string } }) => {
    bookmarked = bookmarked.filter((id) => id !== data.projectId);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

// An href, so the anchor has the link role the queries below look for. The
// rest is the real module, for `isRedirect` and `redirect`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
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
import { listMyBookmarks } from "#/server/bookmarks";

const mockedList = vi.mocked(listMyBookmarks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  session = null;
  bookmarked = ["a", "b"];
});

function renderWith(ui: React.ReactElement, qc = new QueryClient()) {
  const view = render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  );
  return {
    ...view,
    // A fresh element, or React bails out of rendering the same one and the
    // component never reads the switched session.
    rerenderWith: () =>
      view.rerender(
        <QueryClientProvider client={qc}>
          {cloneElement(ui)}
        </QueryClientProvider>
      ),
  };
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

describe("the bookmarks query, keyed on the viewer", () => {
  it("never shows one viewer's count to the next in the same tab", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, rerenderWith } = renderWith(<BookmarksButton />);
    await findByRole("link", { name: "Bookmarks 2" });

    // The next viewer's read never answers, so anything shown is u1's cache.
    mockedList.mockImplementationOnce(
      () => new Promise<never>(() => undefined)
    );
    session = { user: { id: "u2" } };
    rerenderWith();

    expect(await findByRole("link", { name: "Bookmarks" })).toBeTruthy();
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("empties the count, without a redirect, when the server has ended the session", async () => {
    // `requireUser` refuses with a redirect, and the router's query
    // integration navigates on any redirect that reaches the query cache's
    // `onError`, so a focus refetch would carry the tab to /sign-in.
    const onError = vi.fn();
    const qc = new QueryClient({ queryCache: new QueryCache({ onError }) });
    session = { user: { id: "u1" } };
    const { findByRole } = renderWith(<BookmarksButton />, qc);
    await findByRole("link", { name: "Bookmarks 2" });

    mockedList.mockRejectedValueOnce(redirect({ to: "/sign-in" }));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["bookmarks"] });
    });

    expect(await findByRole("link", { name: "Bookmarks" })).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });
});
