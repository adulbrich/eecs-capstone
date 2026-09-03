// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OAuthErrorBanner } from "#/components/oauth-error-banner";
import { brand } from "#/lib/brand";

afterEach(cleanup);

const MAILTO = `mailto:${brand.supportEmail}`;

describe("OAuthErrorBanner", () => {
  it.each([
    "email_is_missing",
    "user_info_is_missing",
  ])("names the capstone office as a mailto link for %s", (code) => {
    render(<OAuthErrorBanner code={code} />);
    const alert = screen.getByRole("alert");
    // Inside the alert, so a screen reader announces the address with the
    // refusal rather than as a separate link somewhere on the page.
    const link = within(alert).getByRole("link", {
      name: brand.supportEmail,
    });
    expect(link.getAttribute("href")).toBe(MAILTO);
  });

  it("carries the link on the fallback for a code it does not know", () => {
    render(<OAuthErrorBanner code="something_better_auth_added" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Sign-in through ONID failed");
    expect(
      within(alert).getByRole("link", { name: brand.supportEmail })
    ).toBeDefined();
  });

  it("leaves account_not_linked alone: the fix is the user's own", () => {
    render(<OAuthErrorBanner code="account_not_linked" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("verify your email first");
    expect(within(alert).queryByRole("link")).toBeNull();
  });

  it("leaves signup_disabled alone", () => {
    render(<OAuthErrorBanner code="signup_disabled" />);
    expect(within(screen.getByRole("alert")).queryByRole("link")).toBeNull();
  });
});
