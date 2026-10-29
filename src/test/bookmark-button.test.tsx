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
/**
 * Projects whose first read has been held. Every later read, such as the one a
 * write's invalidation sends, answers from `rows` at once.
 */
let held = new Set<string>();
/** How many times the button asked the server. */
let reads = 0;
/** How many adds reached the server. */
let writes = 0;
/** Holds the next add open until `finishWrite` is called. */
let holdWrite = false;
let finishWrite: (() => void) | null = null;

vi.mock("#/server/bookmarks", () => ({
  addBookmark: ({ data }: { data: { projectId: string } }) => {
    writes += 1;
    rows.add(data.projectId);
    if (holdWrite) {
      return new Promise((resolve) => {
        finishWrite = () => resolve({ ok: true });
      });
    }
    return Promise.resolve({ ok: true });
  },
  isBookmarked: ({ data }: { data: { projectId: string } }) => {
    reads += 1;
    if (held.has(data.projectId)) {
      return Promise.resolve({ bookmarked: rows.has(data.projectId) });
    }
    held.add(data.projectId);
    return new Promise<{ bookmarked: boolean }>((resolve) => {
      answerRead = (bookmarked) => resolve({ bookmarked });
    });
  },
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
  held = new Set();
  reads = 0;
  writes = 0;
  holdWrite = false;
  finishWrite = null;
});

function renderButton(projectId = "p1") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BookmarkButton projectId={projectId} />
    </QueryClientProvider>
  );
}

/** Lets a query result reach the button, which TanStack Query delivers a tick later. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

/** Answer the held-open read and let every continuation of it run. */
async function answer(bookmarked: boolean) {
  await act(async () => {
    answerRead?.(bookmarked);
    await settle();
  });
}

/** Click and let the write settle, so the assertion reads a final label. */
async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
    await settle();
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

    expect(
      getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();
    expect(rows.has("p1")).toBe(true);
  });

  it("keeps the click's value while the write is in flight and the initial read answers late", async () => {
    // The window before the write's own invalidation: only cancelling the
    // read at the click keeps its stale answer off the button.
    session = { user: { id: "u1" } };
    holdWrite = true;
    const { findByRole, getByRole } = renderButton();

    await click(await findByRole("button", { name: "Bookmark" }));
    await answer(false);
    expect(
      getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();

    await act(async () => {
      finishWrite?.();
      await settle();
    });
    expect(
      getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();
  });

  it("shows what the read returns when no click races it", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    await findByRole("button", { name: "Bookmark" });

    await answer(true);

    expect(
      getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();
  });

  it("drops the previous project's read after the id changes", async () => {
    // The same staleness, reached through the effect rather than a click: the
    // button is reused for a second project while the first project's read is
    // still out, and that read knows nothing about the second one.
    session = { user: { id: "u1" } };
    const view = renderButton("p1");
    await view.findByRole("button", { name: "Bookmark" });
    const answerForP1 = answerRead;

    rows.add("p2");
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <BookmarkButton projectId="p2" />
      </QueryClientProvider>
    );
    await answer(true);
    expect(
      view.getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();

    await act(async () => {
      answerForP1?.(false);
      await settle();
    });

    expect(
      view.getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();
  });

  it("writes once for a double click", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    await findByRole("button", { name: "Bookmark" });
    await answer(false);

    // Each `fireEvent` is its own `act`, so React renders between the two
    // clicks, as it does between two real ones.
    const button = getByRole("button", { name: "Bookmark" });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(settle);

    expect(writes).toBe(1);
    expect(
      getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();
  });

  it("still toggles on a settled page", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    await findByRole("button", { name: "Bookmark" });
    await answer(false);

    await click(getByRole("button", { name: "Bookmark" }));

    expect(
      getByRole("button", { name: "Bookmarked, remove bookmark" })
    ).toBeTruthy();
    expect(rows.has("p1")).toBe(true);
    // The write's invalidation of `["bookmarks"]` reached this key: once on
    // mount, once after the toggle.
    expect(reads).toBe(2);
  });
});
