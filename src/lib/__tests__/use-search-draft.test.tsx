// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { searchParamQuerySchema } from "../search-query";
import { useSearchDraft } from "../use-search-draft";

/**
 * The wrapper at the router level (#588), with a loader that answers only
 * when the test says so: the cancelled-commit cases need a search whose
 * loader has not resolved when Back or Forward lands, which is exactly the
 * window in which `Route.useSearch()` has not moved.
 */
const DELAY = 40;

afterEach(cleanup);

function makeRouter(initialEntries: string[]) {
  const pending = new Map<string, () => void>();
  const commits: string[] = [];

  function SearchBox() {
    const navigate = useNavigate();
    const commit = useCallback(
      (next: string) => {
        commits.push(next);
        void navigate({ to: "/projects", search: { q: next } });
      },
      [navigate]
    );
    const [draft, setDraft] = useSearchDraft(commit, DELAY);
    return (
      <input
        aria-label="Search"
        onChange={(e) => setDraft(e.target.value)}
        value={draft}
      />
    );
  }

  const root = createRootRoute({ component: () => <Outlet /> });
  const search = createRoute({
    getParentRoute: () => root,
    path: "/projects",
    validateSearch: z.object({ q: searchParamQuerySchema }),
    loaderDeps: ({ search: { q } }) => ({ q }),
    // Resolved at once for the entries the test starts on, held otherwise
    // until `answer(q)`.
    loader: ({ deps: { q } }) =>
      new Promise<void>((resolve) => {
        pending.set(q, resolve);
      }),
    component: SearchBox,
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: "/admin",
    loader: () =>
      new Promise<void>((resolve) => {
        pending.set("detail", resolve);
      }),
    component: () => <p>detail</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([search, detail]),
    history: createMemoryHistory({
      initialEntries,
      initialIndex: initialEntries.length - 1,
    }),
  });
  return { router, commits, pending };
}

async function settle(ms = 0) {
  await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

async function start(initialEntries: string[]) {
  const made = makeRouter(initialEntries);
  render(<RouterProvider router={made.router} />);
  // The first load is held like any other; answer it so the box renders.
  await vi.waitFor(() => expect(made.pending.size).toBeGreaterThan(0));
  await act(async () => {
    for (const resolve of made.pending.values()) {
      resolve();
    }
    made.pending.clear();
    await Promise.resolve();
  });
  await screen.findByLabelText("Search");
  return made;
}

const box = () => screen.getByLabelText("Search") as HTMLInputElement;
const urlQ = (router: ReturnType<typeof makeRouter>["router"]) =>
  router.state.location.search.q;

describe("useSearchDraft", () => {
  it("shows the URL's q after Back cancels a search whose loader has not answered", async () => {
    const { router } = await start(["/projects?q="]);

    fireEvent.change(box(), { target: { value: "arduino" } });
    await settle(DELAY + 20);
    expect(urlQ(router)).toBe("arduino");

    // Back before the arduino loader answers: `Route.useSearch()` never saw
    // arduino, so a hook fed from it kept the box reading "arduino".
    await act(() => {
      router.history.back();
      return Promise.resolve();
    });
    await settle(DELAY + 20);

    expect(urlQ(router)).toBe("");
    expect(box().value).toBe("");
  });

  it("commits nothing over an older entry that holds the last committed q", async () => {
    // History foo, bar, foo; the last commit was foo. A draft typed after it,
    // then Back twice inside the debounce, lands on the first foo.
    const { router, commits } = await start([
      "/projects?q=foo",
      "/projects?q=bar",
      "/projects?q=foo",
    ]);

    fireEvent.change(box(), { target: { value: "food" } });
    await act(() => {
      router.history.back();
      return Promise.resolve();
    });
    await act(() => {
      router.history.back();
      return Promise.resolve();
    });
    await settle(DELAY + 20);

    expect(commits).toEqual([]);
    expect(urlQ(router)).toBe("foo");
    expect(box().value).toBe("foo");
  });

  it("reads the cancelled value on Forward after the box was cleared, and commits nothing over it", async () => {
    const { router, commits } = await start(["/projects?q="]);

    fireEvent.change(box(), { target: { value: "arduino" } });
    await settle(DELAY + 20);
    await act(() => {
      router.history.back();
      return Promise.resolve();
    });
    // Typed and cleared again, inside the debounce.
    fireEvent.change(box(), { target: { value: "x" } });
    fireEvent.change(box(), { target: { value: "" } });
    await act(() => {
      router.history.forward();
      return Promise.resolve();
    });
    await settle(DELAY + 20);

    expect(urlQ(router)).toBe("arduino");
    expect(box().value).toBe("arduino");
    expect(commits).toEqual(["arduino"]);
  });

  it("keeps keys typed while its own commit is still loading", async () => {
    // The #501 case, through the router: the commit moves the location at
    // once, so its echo is immediate and never resets the box.
    const { router } = await start(["/projects?q="]);

    fireEvent.change(box(), { target: { value: "ard" } });
    await settle(DELAY + 20);
    fireEvent.change(box(), { target: { value: "arduino" } });
    await settle(5);

    expect(box().value).toBe("arduino");
    await settle(DELAY + 20);
    expect(urlQ(router)).toBe("arduino");
  });

  it("holds the box while a click through to another page loads", async () => {
    // The location moves to /admin at once, but the listing stays on screen
    // until /admin's loader answers; its missing q must not blank the box.
    const { router, commits } = await start(["/projects?q=arduino"]);

    await act(() => {
      void router.navigate({ to: "/admin" });
      return Promise.resolve();
    });
    await settle(DELAY + 20);

    expect(router.state.location.pathname).toBe("/admin");
    expect(box().value).toBe("arduino");
    expect(commits).toEqual([]);
  });

  it("reads a hand-typed numeric q as the route does", async () => {
    // The router parses `?q=123` to the number 123.
    await start(["/projects?q=123"]);
    expect(box().value).toBe("123");
  });
});
