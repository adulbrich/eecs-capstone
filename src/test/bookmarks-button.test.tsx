// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let session: { user: { id: string } } | null = null;

vi.mock("#/server/bookmarks", () => ({
  listMyBookmarks: () => Promise.resolve({ rows: [{ id: "a" }, { id: "b" }] }),
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

import { BookmarksButton } from "#/components/bookmarks-button";

afterEach(() => {
  cleanup();
  session = null;
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
});
