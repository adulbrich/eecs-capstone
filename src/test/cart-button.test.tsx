// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("#/server/inventory", () => ({
  getCart: () => Promise.resolve([{ itemId: "x" }, { itemId: "y" }]),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

import { CartButton } from "#/components/cart-button";

describe("CartButton", () => {
  it("renders the count when > 0", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["cart"], [{ itemId: "x" }, { itemId: "y" }]);
    const { findByText } = render(
      <QueryClientProvider client={qc}>
        <CartButton />
      </QueryClientProvider>
    );
    expect(await findByText("2")).toBeDefined();
  });

  it("hides the count when 0", () => {
    const qc = new QueryClient();
    qc.setQueryData(["cart"], []);
    const { queryByText } = render(
      <QueryClientProvider client={qc}>
        <CartButton />
      </QueryClientProvider>
    );
    expect(queryByText("0")).toBeNull();
  });
});
