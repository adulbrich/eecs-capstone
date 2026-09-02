// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { server, session } = vi.hoisted(() => ({
  server: {
    addBookmark: vi.fn(),
    listMyBookmarkIds: vi.fn(),
    removeBookmark: vi.fn(),
  },
  session: { data: null as null | { user: { id: string } } },
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => session },
}));
vi.mock("#/server/bookmarks", () => server);
vi.mock("@tanstack/react-router", () => ({
  // `to` becomes the href so the anchor has the link role; the real Link
  // interpolates params, which no assertion here depends on.
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

import { BookmarkSetProvider, BookmarkToggle } from "#/components/bookmark-set";
import { ProjectCard, type ProjectSummary } from "#/components/project-card";

beforeEach(() => {
  session.data = { user: { id: "u1" } };
  server.listMyBookmarkIds.mockResolvedValue({ ids: ["p1"] });
  server.addBookmark.mockResolvedValue({ ok: true });
  server.removeBookmark.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Listing() {
  return (
    <BookmarkSetProvider>
      <BookmarkToggle projectId="p1" />
      <BookmarkToggle projectId="p2" />
    </BookmarkSetProvider>
  );
}

describe("BookmarkToggle", () => {
  it("renders nothing outside a provider", () => {
    render(<BookmarkToggle projectId="p1" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a signed-out viewer", async () => {
    session.data = null;
    render(<Listing />);
    // Give any fetch a chance to land before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button")).toBeNull();
    expect(server.listMyBookmarkIds).not.toHaveBeenCalled();
  });

  it("reads each row's state from one fetch of the viewer's ids", async () => {
    render(<Listing />);
    expect(
      await screen.findByRole("button", { name: "Remove bookmark" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bookmark" })).toBeTruthy();
    expect(server.listMyBookmarkIds).toHaveBeenCalledTimes(1);
  });

  it("flips on click and tells the server", async () => {
    render(<Listing />);
    const remove = await screen.findByRole("button", {
      name: "Remove bookmark",
    });
    remove.click();
    await waitFor(() =>
      expect(server.removeBookmark).toHaveBeenCalledWith({
        data: { projectId: "p1" },
      })
    );
    expect(screen.getAllByRole("button", { name: "Bookmark" })).toHaveLength(2);

    screen.getAllByRole("button", { name: "Bookmark" })[1].click();
    await waitFor(() =>
      expect(server.addBookmark).toHaveBeenCalledWith({
        data: { projectId: "p2" },
      })
    );
    expect(
      screen.getAllByRole("button", { name: "Remove bookmark" })
    ).toHaveLength(1);
  });

  it("reverts when the server refuses", async () => {
    server.removeBookmark.mockRejectedValue(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => {
      // The revert logs; the log is not what this test is about.
    });
    render(<Listing />);
    const remove = await screen.findByRole("button", {
      name: "Remove bookmark",
    });
    remove.click();
    await waitFor(() => expect(server.removeBookmark).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: "Remove bookmark" })
    ).toBeTruthy();
  });

  it("sits beside a card's link, never inside it", async () => {
    const project: ProjectSummary = {
      id: "p1",
      title: "Rover",
      description: null,
      status: "published",
    };
    render(
      <BookmarkSetProvider>
        <ProjectCard project={project} />
      </BookmarkSetProvider>
    );
    const button = await screen.findByRole("button", {
      name: "Remove bookmark",
    });
    // A button inside an anchor is invalid HTML and a nested interactive
    // control to axe, which is why the card is no longer an `asChild` link.
    expect(button.closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: /Rover/ })).toBeTruthy();
  });
});
