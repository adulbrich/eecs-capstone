// @vitest-environment jsdom
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

import { InventoryCard } from "#/components/inventory-card";

afterEach(cleanup);

const item = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Arduino Uno",
  description: "Microcontroller board for prototyping.",
  imageUrl: null,
  status: "available" as const,
};

describe("InventoryCard", () => {
  it("renders name, description, and status", () => {
    const { getByText } = render(
      <InventoryCard item={item} signedIn={false} />
    );
    expect(getByText("Arduino Uno")).toBeTruthy();
    expect(getByText("Microcontroller board for prototyping.")).toBeTruthy();
    expect(getByText("Available")).toBeTruthy();
  });

  it("shows Add to cart only when signed in and available", () => {
    const onAddToCart = vi.fn();
    const { getByText, queryByText, rerender } = render(
      <InventoryCard item={item} onAddToCart={onAddToCart} signedIn />
    );
    expect(getByText("Add to cart")).toBeTruthy();
    rerender(
      <InventoryCard
        item={{ ...item, status: "reserved" }}
        onAddToCart={onAddToCart}
        signedIn
      />
    );
    expect(queryByText("Add to cart")).toBeNull();
  });
});
