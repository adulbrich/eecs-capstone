// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installResizeObserver } from "./radix-jsdom";

let session: { user: { id: string; email: string; name: string } } | null =
  null;

vi.mock("#/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: session, isPending: false }),
    signOut: () => Promise.resolve(),
  },
}));

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

// Both call server functions on mount; neither is what this file is about.
vi.mock("#/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));
vi.mock("#/components/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

import { SiteHeader } from "#/components/site-header";
import { brand } from "#/lib/brand";

beforeAll(installResizeObserver);
afterEach(() => {
  cleanup();
  session = null;
});

const SOURCE_LINK = "Source code on GitHub";

describe("SiteHeader source link", () => {
  it("renders for an anonymous viewer", () => {
    render(<SiteHeader />);
    const link = screen.getByRole("link", { name: SOURCE_LINK });
    expect(link.getAttribute("href")).toBe(brand.repositoryUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders for a signed-in viewer too", () => {
    session = { user: { id: "u1", email: "a@b.test", name: "A" } };
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: SOURCE_LINK })).toBeTruthy();
  });

  it("is named so it cannot be confused with the GitHub sign-in button", () => {
    // /sign-in and /sign-up render "Continue with GitHub". A header link named
    // just "GitHub" would read as a second route to the same action.
    render(<SiteHeader />);
    expect(screen.queryByRole("link", { name: /^GitHub$/ })).toBeNull();
  });

  it("is the last item in the mobile navigation sheet", async () => {
    render(<SiteHeader />);
    await userEvent.click(
      screen.getByRole("button", { name: "Open navigation" })
    );
    // The open Sheet is a modal dialog, so Radix marks everything outside it
    // aria-hidden and the desktop link drops out of role queries: what is
    // found here is the Sheet's own copy.
    const sheet = await screen.findByRole("dialog");
    const link = within(sheet).getByRole("link", { name: SOURCE_LINK });
    expect(link.getAttribute("href")).toBe(brand.repositoryUrl);
    const items = Array.from(sheet.querySelectorAll("nav a"));
    expect(items.at(-1)).toBe(link);
  });
});
