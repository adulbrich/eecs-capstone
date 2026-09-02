// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrivacyPolicy } from "#/components/privacy-policy";
import { brand } from "#/lib/brand";

afterEach(cleanup);

describe("PrivacyPolicy", () => {
  it("states the four points the policy exists to make", () => {
    render(<PrivacyPolicy />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy" })
    ).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("We do not sell it");
    expect(text).toContain("What is public stays public.");
    expect(text).toContain("You can close your account.");
    expect(text).toContain('re-attributed to "Deleted user"');
    expect(text).toContain("institutional property records");
    expect(text).toContain(
      "a new account cannot be linked back to old projects"
    );
  });

  it("links the support address from the brand", () => {
    render(<PrivacyPolicy />);
    // The address itself is brand config, not this component's business: a
    // rebrand must not red a component test. The href is what this owns.
    const link = screen.getByRole("link", { name: brand.supportEmail });
    expect(link.getAttribute("href")).toBe(`mailto:${brand.supportEmail}`);
  });
});
