// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetTrafficDocument, useTraffic } from "#/lib/use-traffic";

/**
 * The hook at the router level: a tree shaped like the app's, a pathless
 * `_public` layout rendering the hook beside a pathless `_authed` one, so the
 * route ids are the ones `isTrafficRoute` reads in production.
 */
function PublicLayout() {
  useTraffic();
  return <Outlet />;
}

function makeRouter(initial: string) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const publicLayout = createRoute({
    getParentRoute: () => root,
    id: "_public",
    component: PublicLayout,
  });
  const listing = createRoute({
    getParentRoute: () => publicLayout,
    path: "/projects",
    validateSearch: z.object({
      q: z.string().default(""),
      view: z.enum(["card", "table"]).optional(),
    }),
    component: () => <p>listing</p>,
  });
  const detail = createRoute({
    getParentRoute: () => publicLayout,
    path: "/projects/$projectId",
    component: () => <p>detail</p>,
  });
  const authed = createRoute({
    getParentRoute: () => root,
    id: "_authed",
    component: () => <Outlet />,
  });
  const admin = createRoute({
    getParentRoute: () => authed,
    path: "/admin",
    component: () => <p>admin</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      publicLayout.addChildren([listing, detail]),
      authed.addChildren([admin]),
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve({ ok: true })
);

/** The bodies sent so far, parsed. */
function sent(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
}

/** Lets any send a navigation would cause happen before asserting there was none. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

beforeEach(() => {
  resetTrafficDocument();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTraffic", () => {
  it("sends exactly one view on landing, with only the route's own search keys", async () => {
    makeRouter("/projects?q=robot&stray=1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/traffic");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "omit",
    });
    expect(sent()[0]).toEqual({
      kind: "view",
      pathname: "/projects",
      search: { q: "robot" },
    });
  });

  it("sends the referrer on the first event of the document only", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue(
      "https://www.google.com/"
    );
    const router = makeRouter("/projects");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() =>
      router.navigate({
        to: "/projects/$projectId",
        params: { projectId: "a" },
      })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent()[0].referrer).toBe("https://www.google.com/");
    expect(sent()[1].referrer).toBeUndefined();
  });

  it("sends one view per new pathname, naming the previous one", async () => {
    const router = makeRouter("/projects");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() =>
      router.navigate({
        to: "/projects/$projectId",
        params: { projectId: "abc" },
      })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent()[1]).toEqual({
      kind: "view",
      pathname: "/projects/abc",
      previousPath: "/projects",
    });
  });

  it("sends one search when only the search changes", async () => {
    const router = makeRouter("/projects");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() =>
      router.navigate({ to: "/projects", search: { q: "", view: "table" } })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent()[1]).toEqual({
      kind: "search",
      pathname: "/projects",
      previousPath: "/projects",
      search: { q: "", view: "table" },
    });
  });

  it("sends nothing for a hash-only change or a preloaded link", async () => {
    const router = makeRouter("/projects");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() =>
      router.navigate({ to: "/projects", search: { q: "" }, hash: "top" })
    );
    await act(() =>
      router.preloadRoute({
        to: "/projects/$projectId",
        params: { projectId: "hovered" },
      })
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing on a signed-in route, and one view on coming back", async () => {
    const router = makeRouter("/projects");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() => router.navigate({ to: "/admin" }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => router.navigate({ to: "/projects" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent()[1]).toEqual({
      kind: "view",
      pathname: "/projects",
      search: { q: "" },
    });
  });

  it("sends nothing when the document lands on a signed-in route", async () => {
    makeRouter("/admin");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("touches neither cookies nor browser storage", async () => {
    const cookieGet = vi.spyOn(Document.prototype, "cookie", "get");
    const cookieSet = vi.spyOn(Document.prototype, "cookie", "set");
    const storage = [
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
    ];
    const router = makeRouter("/projects");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() =>
      router.navigate({ to: "/projects", search: { q: "robot" } })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(cookieGet).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
    for (const spy of storage) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
