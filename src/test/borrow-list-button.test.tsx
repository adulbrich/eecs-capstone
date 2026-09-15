// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let cart: { itemId: string }[] = [];
let session: { user: { id: string } } | null = null;

vi.mock("#/server/inventory", () => ({
  addToCart: ({ data }: { data: { itemId: string } }) => {
    cart = [...cart, { itemId: data.itemId }];
    return Promise.resolve({ ok: true });
  },
  getCart: () => Promise.resolve(cart),
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

import { AddToCartButton } from "#/components/add-to-cart-button";
import { BorrowListButton } from "#/components/borrow-list-button";

afterEach(() => {
  cleanup();
  cart = [];
  session = null;
});

function renderWith(ui: React.ReactElement, seeded?: { itemId: string }[]) {
  const qc = new QueryClient();
  if (seeded) {
    qc.setQueryData(["cart"], seeded);
  }
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
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
