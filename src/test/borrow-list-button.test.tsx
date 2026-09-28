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

let cart: { itemId: string }[] = [];
let session: { user: { id: string } } | null = null;

vi.mock("#/server/inventory", () => ({
  addToCart: ({ data }: { data: { itemId: string } }) => {
    cart = [...cart, { itemId: data.itemId }];
    return Promise.resolve({ ok: true });
  },
  getCart: vi.fn(() => Promise.resolve(cart)),
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

import { AddToCartButton } from "#/components/add-to-cart-button";
import { BorrowListButton } from "#/components/borrow-list-button";
import { getCart } from "#/server/inventory";

const mockedGetCart = vi.mocked(getCart);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cart = [];
  session = null;
});

function renderWith(
  ui: React.ReactElement,
  seeded?: { itemId: string }[],
  qc = new QueryClient()
) {
  if (seeded) {
    qc.setQueryData(["cart", "u1"], seeded);
  }
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

// The next viewer's read never answers, so anything shown is the last
// viewer's cache.
function nextViewerPending() {
  mockedGetCart.mockImplementationOnce(
    () => new Promise<never>(() => undefined)
  );
  session = { user: { id: "u2" } };
}

describe("BorrowListButton", () => {
  it("renders nothing for an anonymous viewer", async () => {
    // /inventory is public, and getCart throws without a session, so the
    // gate lives in the button rather than in the page that mounts it.
    const { queryByRole, findByText } = renderWith(
      <>
        <BorrowListButton />
        <span>sentinel</span>
      </>
    );
    await findByText("sentinel");
    expect(queryByRole("link", { name: /Borrow list/ })).toBeNull();
  });

  it("renders the count when > 0", async () => {
    session = { user: { id: "u1" } };
    const { findByRole } = renderWith(<BorrowListButton />, [
      { itemId: "x" },
      { itemId: "y" },
    ]);
    const link = await findByRole("link", { name: "Borrow list 2" });
    expect(link.getAttribute("href")).toBe("/my/items");
  });

  it("hides the count when 0", async () => {
    session = { user: { id: "u1" } };
    const { findByRole, queryByText } = renderWith(<BorrowListButton />, []);
    await findByRole("link", { name: "Borrow list" });
    expect(queryByText("0")).toBeNull();
  });

  it("updates without a reload when an item is added", async () => {
    // The count and the add button share the ["cart"] query key, so the
    // add button's invalidation is what refreshes the count.
    session = { user: { id: "u1" } };
    const { findByRole } = renderWith(
      <>
        <BorrowListButton />
        <AddToCartButton itemId="item-1" />
      </>
    );
    await findByRole("link", { name: "Borrow list" });
    fireEvent.click(await findByRole("button", { name: "Borrow" }));
    await findByRole("button", { name: "In borrow list" });
    expect(await findByRole("link", { name: "Borrow list 1" })).toBeTruthy();
  });
});

describe("the borrow list query, keyed on the viewer", () => {
  it("never shows one viewer's count to the next in the same tab", async () => {
    session = { user: { id: "u1" } };
    cart = [{ itemId: "x" }, { itemId: "y" }];
    const { findByRole, rerenderWith } = renderWith(<BorrowListButton />);
    await findByRole("link", { name: "Borrow list 2" });

    nextViewerPending();
    rerenderWith();

    expect(await findByRole("link", { name: "Borrow list" })).toBeTruthy();
    expect(mockedGetCart).toHaveBeenCalledTimes(2);
  });

  it("never marks the next viewer's item as in their list", async () => {
    session = { user: { id: "u1" } };
    cart = [{ itemId: "item-1" }];
    const { findByRole, rerenderWith } = renderWith(
      <AddToCartButton itemId="item-1" />
    );
    await findByRole("button", { name: "In borrow list" });

    nextViewerPending();
    rerenderWith();

    expect(await findByRole("button", { name: "Borrow" })).toBeTruthy();
  });

  it("empties the count, without a redirect, when the server has ended the session", async () => {
    // `requireUser` refuses with a redirect, and the router's query
    // integration navigates on any redirect that reaches the query cache's
    // `onError`, so a focus refetch would carry the tab to /sign-in.
    const onError = vi.fn();
    const qc = new QueryClient({ queryCache: new QueryCache({ onError }) });
    session = { user: { id: "u1" } };
    cart = [{ itemId: "x" }];
    const { findByRole } = renderWith(<BorrowListButton />, undefined, qc);
    await findByRole("link", { name: "Borrow list 1" });

    mockedGetCart.mockRejectedValueOnce(redirect({ to: "/sign-in" }));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["cart"] });
    });

    expect(await findByRole("link", { name: "Borrow list" })).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("AddToCartButton compact", () => {
  it("keeps the accessible name Borrow while hiding the text below md", async () => {
    // The mobile row of the public inventory table (#401): the name is the
    // aria-label at every width, and only the text goes below `md`.
    const { findByRole } = renderWith(<AddToCartButton compact itemId="i1" />);
    const button = await findByRole("button", { name: "Borrow" });
    expect(button.getAttribute("title")).toBe("Borrow");
    const text = button.querySelector("span");
    expect(text?.textContent).toBe("Borrow");
    expect(text?.className).toBe("hidden md:inline");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("shows the text at every width without compact, and once in the list", async () => {
    const { findByRole } = renderWith(<AddToCartButton itemId="i1" />);
    const button = await findByRole("button", { name: "Borrow" });
    expect(button.querySelector("span")?.className).toBe("");
    fireEvent.click(button);
    const added = await findByRole("button", { name: "In borrow list" });
    expect(added.querySelector("span")?.textContent).toBe("In borrow list");
  });
});
