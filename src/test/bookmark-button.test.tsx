// @vitest-environment jsdom
import { fc, test } from "@fast-check/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

interface Server {
  addBookmark: () => Promise<{ ok: true }>;
  isBookmarked: () => Promise<{ bookmarked: boolean }>;
  removeBookmark: () => Promise<{ ok: true }>;
}
/** Set by the scheduler property, which answers every call itself. */
let server: Server | null = null;

vi.mock("#/server/bookmarks", () => ({
  addBookmark: ({ data }: { data: { projectId: string } }) => {
    if (server) {
      return server.addBookmark();
    }
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
    if (server) {
      return server.isBookmarked();
    }
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
    if (server) {
      return server.removeBookmark();
    }
    rows.delete(data.projectId);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

import { BookmarkButton } from "#/components/bookmark-button";
import { bookmarkLabel } from "#/components/bookmark-set";

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
  server = null;
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

/**
 * Two clicks inside one tick, before React can render the button disabled.
 * Two `fireEvent.click` calls would render between them, as two real clicks do.
 */
function doubleClickInOneTick(button: HTMLElement) {
  for (const _ of [1, 2]) {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  }
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

  it("starts its name with the word it shows, in both states", async () => {
    // A voice user says the visible word, so the name has to contain it
    // (WCAG 2.5.3, #789). `textContent` ignores CSS, so it reads the span
    // that `hidden md:inline` shows from `md` up.
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    const startsWithItsText = (button: HTMLElement) =>
      Boolean(button.textContent) &&
      button.getAttribute("aria-label")?.startsWith(button.textContent ?? "");
    expect(
      startsWithItsText(await findByRole("button", { name: "Bookmark" }))
    ).toBe(true);

    await answer(true);

    expect(
      startsWithItsText(
        getByRole("button", { name: "Bookmarked, remove bookmark" })
      )
    ).toBe(true);
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

  it("writes once for a double click inside one tick", async () => {
    // The scheduler property's shrunk counterexample (#846). Both clicks run
    // before React renders the button disabled, so the disabled prop cannot
    // refuse the second, which read the same value and wrote it again.
    session = { user: { id: "u1" } };
    const { findByRole, getByRole } = renderButton();
    await findByRole("button", { name: "Bookmark" });
    await answer(false);

    const button = getByRole("button", { name: "Bookmark" });
    await act(() => {
      doubleClickInOneTick(button);
      return settle();
    });

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

/**
 * The orders the tests above name, and the ones nobody wrote down: clicks
 * interleaved with the `isBookmarked` read and the writes, each answered
 * whenever the scheduler lets it, and a write stored or refused (#846). A
 * double click inside one tick is one of the steps: the second click's
 * handler runs before React renders the button disabled, so only a ref
 * refuses it.
 */
describe("BookmarkButton under any interleaving", () => {
  type Click = "click" | "doubleClick";

  /** Steps in a run, and so at most this many writes the button should send. */
  const MAX_STEPS = 6;

  const oneInFour = fc.nat({ max: 3 }).map((n) => n === 0);
  const stepPlan = fc.array(
    fc.tuple(fc.constantFrom<Click>("click", "doubleClick"), oneInFour),
    { maxLength: MAX_STEPS, size: "max" }
  );

  const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * Lets a settled call reach the button. Two macrotasks: Query notifies its
   * observers on a timer of its own, which the click's microtasks register
   * after the first one here.
   */
  async function flush() {
    await act(async () => {
      await macrotask();
      await macrotask();
    });
  }

  const showsSet = (button: HTMLElement) =>
    button.getAttribute("aria-label") === bookmarkLabel(true);

  test.prop([
    // Awaited inside an async function: React's `act` returns a thenable that
    // pops its scope once per `then`, and `waitNext` attaches two.
    fc.scheduler({
      act: async (f) => {
        await act(f);
      },
    }),
    // Whether the row exists before the page loads.
    fc.boolean(),
    // Each step, then whether the scheduler releases one pending call.
    stepPlan,
    // Whether the nth write is refused. Twice the steps, so a double click
    // that writes twice still finds an answer.
    fc.array(fc.boolean(), {
      minLength: 2 * MAX_STEPS,
      maxLength: 2 * MAX_STEPS,
    }),
  ])(
    "writes once per click it takes, never lets a read from before a click land, and restores a refused click",
    async (s, storedAtLoad, plan, refusals) => {
      // `afterEach` runs once per property, not once per run.
      cleanup();
      session = { user: { id: "u1" } };
      let stored = storedAtLoad;
      let writeCount = 0;
      /** What the button showed before each click it took; the nth sent write n. */
      const shownBefore: boolean[] = [];

      const answerWrite = s.scheduleFunction((value: boolean, n: number) => {
        if (refusals[n]) {
          const refusal = Promise.reject(new Error(`write ${n} refused`));
          // The scheduler observes it only when it releases the call, and
          // Node reports a rejection nobody observed by the next macrotask.
          refusal.catch(() => undefined);
          return refusal;
        }
        stored = value;
        return Promise.resolve({ ok: true as const });
      });
      // The server reads the row when the request arrives, not when the
      // answer does: that gap is what makes a read stale.
      const readStored = s.scheduleFunction(() =>
        Promise.resolve({ bookmarked: stored })
      );
      const write = (value: boolean) => {
        const n = writeCount;
        writeCount += 1;
        return answerWrite(value, n);
      };
      server = {
        addBookmark: () => write(true),
        isBookmarked: () => readStored(),
        removeBookmark: () => write(false),
      };

      try {
        renderButton();
        await screen.findByRole("button");

        for (const [gesture, release] of plan) {
          const button = screen.getByRole("button") as HTMLButtonElement;
          if (!button.disabled) {
            shownBefore.push(showsSet(button));
          }
          if (gesture === "click") {
            fireEvent.click(button);
          } else {
            await act(() => {
              doubleClickInOneTick(button);
              return Promise.resolve();
            });
          }
          await flush();
          if (release && s.count() > 0) {
            await s.waitNext(1);
            await flush();
          }
          // While a click's write is out, the button holds that click's
          // value whatever read lands meanwhile.
          const latest = shownBefore.at(-1);
          if (button.disabled && latest !== undefined) {
            expect(showsSet(button)).toBe(!latest);
          }
        }
        // A stored write refetches on a macrotask, after `waitIdle` has
        // already found nothing left to release.
        do {
          await s.waitIdle();
          await flush();
        } while (s.count() > 0);

        expect(writeCount).toBe(shownBefore.length);
        const button = screen.getByRole("button") as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        const last = shownBefore.length - 1;
        if (last >= 0 && refusals[last]) {
          // A refused click puts back what it replaced.
          expect(showsSet(button)).toBe(shownBefore[last]);
        } else if (last >= 0) {
          // A stored click wrote the value it showed.
          expect(stored).toBe(!shownBefore[last]);
        }
        if (last < 0 || shownBefore.some((_, n) => !refusals[n])) {
          // The row as the read at load or the last stored write left it.
          expect(showsSet(button)).toBe(stored);
        }
      } finally {
        cleanup();
        server = null;
      }
    }
  );
});
