// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OAuthErrorBanner } from "#/components/oauth-error-banner";
import { brand } from "#/lib/brand";

afterEach(cleanup);

const MAILTO = `mailto:${brand.supportEmail}`;

describe("OAuthErrorBanner", () => {
  it.each([
    ["account_not_linked", "onid"],
    ["account_not_linked", "github"],
    ["account_not_linked", undefined],
    ["email_is_missing", "onid"],
    ["user_info_is_missing", "onid"],
  ] as const)(
    "names the capstone office as a mailto link for %s from %s",
    (code, provider) => {
      render(<OAuthErrorBanner code={code} provider={provider} />);
      const alert = screen.getByRole("alert");
      // Inside the alert, so a screen reader announces the address with the
      // refusal rather than as a separate link somewhere on the page.
      const link = within(alert).getByRole("link", {
        name: brand.supportEmail,
      });
      expect(link.getAttribute("href")).toBe(MAILTO);
    }
  );

  it("carries the link on the fallback for a code it does not know", () => {
    render(
      <OAuthErrorBanner code="something_better_auth_added" provider="onid" />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Sign-in through ONID failed");
    expect(
      within(alert).getByRole("link", { name: brand.supportEmail })
    ).toBeDefined();
  });

  // #579: GitHub refusals reach this banner now, and used to be told that
  // ONID failed.
  it.each(["access_denied", "BANNED_USER", "unable_to_link_account"])(
    "names GitHub, not ONID, when GitHub fails with %s",
    (code) => {
      render(<OAuthErrorBanner code={code} provider="github" />);
      const text = screen.getByRole("alert").textContent;
      expect(text).toContain("Sign-in through GitHub failed");
      expect(text).not.toContain("ONID");
    }
  );

  it("names no provider when the URL carries none", () => {
    render(<OAuthErrorBanner code="access_denied" />);
    const text = screen.getByRole("alert").textContent;
    expect(text).toContain("Sign-in failed");
    expect(text).not.toMatch(/ONID|GitHub/);
  });

  it("points a GitHub account_not_linked at the emailed code", () => {
    render(<OAuthErrorBanner code="account_not_linked" provider="github" />);
    const text = screen.getByRole("alert").textContent;
    expect(text).toContain("Sign in with an emailed code");
    expect(text).not.toContain("ONID");
  });

  it("keeps ONID's account_not_linked a support contact", () => {
    // What reaches it from ONID is a row the emailed code refuses too, so
    // pointing at the code would send the person round in a circle.
    render(<OAuthErrorBanner code="account_not_linked" provider="onid" />);
    expect(screen.getByRole("alert").textContent).not.toMatch(/emailed code/i);
  });

  // The advice this used to give, sign in with the password and verify the
  // address, stopped being possible when the password went (#576). Nothing on
  // the page may still send somebody to it.
  it("sends nobody to a password", () => {
    for (const provider of ["onid", "github", undefined] as const) {
      render(
        <OAuthErrorBanner code="account_not_linked" provider={provider} />
      );
      expect(screen.getByRole("alert").textContent).not.toMatch(/password/i);
      cleanup();
    }
    render(<OAuthErrorBanner code="something_better_auth_added" />);
    expect(screen.getByRole("alert").textContent).not.toMatch(/password/i);
  });

  it("leaves signup_disabled alone", () => {
    render(<OAuthErrorBanner code="signup_disabled" />);
    expect(within(screen.getByRole("alert")).queryByRole("link")).toBeNull();
  });
});
