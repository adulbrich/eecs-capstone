// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/server/inventory", () => ({
  addToCart: vi.fn(),
  getCart: () => Promise.resolve([]),
}));
vi.mock("@tanstack/react-router", () => ({
  // `to` becomes the href so the anchor has the link role; the real Link
  // interpolates params, which no assertion here depends on.
  Link: ({
    children,
    params: _params,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { InventoryCard } from "#/components/inventory-card";

afterEach(cleanup);

const item = {
  id: "00000000-0000-0000-0000-000000000002",
  name: "Oscilloscope",
  description: "Two channels.",
  categories: [{ id: "c1", name: "Electronics" }],
  imageUrl: "inventory/a/b.webp",
  status: "available" as const,
};

describe("InventoryCard", () => {
  it("stacks the image above the text below md and beside it from md up", () => {
    const { container } = render(
      <InventoryCard item={item} signedIn={false} />
    );
    const classes = container.querySelector("img")?.className ?? "";
    expect(classes).toContain("aspect-[16/9]");
    expect(classes).toContain("w-full");
    expect(classes).toContain("md:aspect-[3/2]");
    expect(classes).toContain("md:w-40");
  });

  it("links the whole image-and-text area", () => {
    const { container, getByRole } = render(
      <InventoryCard item={item} signedIn={false} />
    );
    expect(container.firstElementChild?.tagName).not.toBe("A");
    expect(getByRole("link", { name: /Oscilloscope/ })).toBeTruthy();
  });
});
