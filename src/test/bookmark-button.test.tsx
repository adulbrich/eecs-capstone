// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let session: { user: { id: string } } | null = null;
let rows = new Set<string>();

/**
 * The initial read, held open so a test can answer it after the click #444 is
 * about. Calling it resolves the read with the value the server would have
 * computed before that click landed.
 */
let answerRead: ((bookmarked: boolean) => void) | null = null;

vi.mock("#/server/bookmarks", () => ({
  addBookmark: ({ data }: { data: { projectId: string } }) => {
    rows.add(data.projectId);
    return Promise.resolve({ ok: true });
  },
  isBookmarked: () =>
    new Promise<{ bookmarked: boolean }>((resolve) => {
      answerRead = (bookmarked) => resolve({ bookmarked });
    }),
  listMyBookmarkIds: () => Promise.resolve({ ids: [...rows] }),
  removeBookmark: ({ data }: { data: { projectId: string } }) => {
    rows.delete(data.projectId);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

import { BookmarkButton } from "#/components/bookmark-button";

afterEach(() => {
  cleanup();
  session = null;
  rows = new Set();
  answerRead = null;
});

function renderButton() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BookmarkButton projectId="p1" />
    </QueryClientProvider>
  );
}

/** Answer the held-open read and let every continuation of it run. */
async function answer(bookmarked: boolean) {
  await act(async () => {
    answerRead?.(bookmarked);
    await Promise.resolve();
  });
}

/** Click and let the write settle, so the assertion reads a final label. */
async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });
}

describe("BookmarkButton", () => {
  it("keeps a bookmark made while the initial read was still in flight", async () => {
    // The read answers after the click, with the value it computed before the
    // insert. It must not win: the row is written, so the label has to say so.
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();

    await click(await findByRole("button", { name: "Bookmark" }));
    await answer(false);

    expect(getByRole("button", { name: "Remove bookmark" })).toBeTruthy();
    expect(rows.has("p1")).toBe(true);
  });

  it("shows what the read returns when no click races it", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    await findByRole("button", { name: "Bookmark" });

    await answer(true);

    expect(getByRole("button", { name: "Remove bookmark" })).toBeTruthy();
  });

  it("still toggles on a settled page", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    await findByRole("button", { name: "Bookmark" });
    await answer(false);

    await click(getByRole("button", { name: "Bookmark" }));

    expect(getByRole("button", { name: "Remove bookmark" })).toBeTruthy();
    expect(rows.has("p1")).toBe(true);
  });
});
