// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("#/server/inventory", () => ({
  addToCart: () => Promise.resolve({ ok: true }),
  getCart: () => Promise.resolve([]),
}));

import { InventoryCard } from "#/components/inventory-card";

afterEach(cleanup);

/** The card's Add to cart button reads the shared cart query. */
function renderCard(ui: React.ReactElement, cart: { itemId: string }[] = []) {
  const qc = new QueryClient();
  qc.setQueryData(["cart"], cart);
  const result = render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  );
  return {
    ...result,
    rerenderCard: (next: React.ReactElement) =>
      result.rerender(
        <QueryClientProvider client={qc}>{next}</QueryClientProvider>
      ),
  };
}

const item = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Arduino Uno",
  description: "Microcontroller board for prototyping.",
  categories: [{ id: "cat-1", name: "Microcontroller" }],
  imageUrl: null,
  status: "available" as const,
};

describe("InventoryCard", () => {
  it("renders name, description, status, and category", () => {
    const { getByText } = renderCard(
      <InventoryCard item={item} signedIn={false} />
    );
    expect(getByText("Arduino Uno")).toBeTruthy();
    expect(getByText("Microcontroller board for prototyping.")).toBeTruthy();
    expect(getByText("Available")).toBeTruthy();
    expect(getByText("Microcontroller")).toBeTruthy();
  });

  it("omits the category chips when categories is empty", () => {
    const { queryByText } = renderCard(
      <InventoryCard item={{ ...item, categories: [] }} signedIn={false} />
    );
    expect(queryByText("Microcontroller")).toBeNull();
  });

  it("shows Add to cart only when signed in and available", () => {
    const { getByText, queryByText, rerenderCard } = renderCard(
      <InventoryCard item={item} signedIn />
    );
    expect(getByText("Add to cart")).toBeTruthy();
    rerenderCard(
      <InventoryCard item={{ ...item, status: "reserved" }} signedIn />
    );
    expect(queryByText("Add to cart")).toBeNull();
  });

  it("reads In cart from the cart, not from a click", () => {
    // The state lives in the cart query, so an item added on another page
    // shows as already added on first paint here.
    const { getByText, queryByText } = renderCard(
      <InventoryCard item={item} signedIn />,
      [{ itemId: item.id }]
    );
    expect(getByText("In cart")).toBeTruthy();
    expect(queryByText("Add to cart")).toBeNull();
  });

  it("disables the button once the item is in the cart", () => {
    const { getByRole } = renderCard(<InventoryCard item={item} signedIn />, [
      { itemId: item.id },
    ]);
    expect(getByRole("button")).toHaveProperty("disabled", true);
  });
});
