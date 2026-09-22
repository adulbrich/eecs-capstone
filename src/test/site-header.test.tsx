// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    // /sign-in renders "Continue with GitHub". A header link named just
    // "GitHub" would read as a second route to the same action.
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

// One page signs in and creates accounts (#586), so a second header control
// would be two buttons to the same form.
describe("SiteHeader signed-out control", () => {
  it("is one Sign in link on desktop, with no Sign up", () => {
    render(<SiteHeader />);
    const links = screen.getAllByRole("link", { name: "Sign in" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
  });

  it("is one Sign in link in the mobile sheet, with no Sign up", async () => {
    render(<SiteHeader />);
    await userEvent.click(
      screen.getByRole("button", { name: "Open navigation" })
    );
    // Queried inside the Sheet: Radix hides the desktop copy while it is open.
    const sheet = await screen.findByRole("dialog");
    const links = within(sheet).getAllByRole("link", { name: "Sign in" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/sign-in");
    expect(within(sheet).queryByRole("link", { name: /sign up/i })).toBeNull();
  });
});

describe("SiteHeader mobile navigation", () => {
  it("closes from its own close button", async () => {
    render(<SiteHeader />);
    await userEvent.click(
      screen.getByRole("button", { name: "Open navigation" })
    );
    const sheet = await screen.findByRole("dialog");
    // The sheet's X is its only close control: SheetContent renders none of
    // its own, so this button going missing would leave the sheet closable
    // only by Escape or the overlay.
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Close navigation" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Open navigation" })
    ).toBeTruthy();
  });
});
