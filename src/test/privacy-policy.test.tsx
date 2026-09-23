// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  // One assertion per claim the page-view paragraph makes (#513). Each names
  // the test that makes the claim true, and a claim with no test behind it
  // does not belong in the copy.
  describe("the page-view paragraph", () => {
    const text = () => {
      render(<PrivacyPolicy />);
      return document.body.textContent ?? "";
    };

    it("says page views are counted without cookies", () => {
      // use-traffic.test.tsx: the hook touches neither document.cookie nor
      // storage. traffic-writer.test.ts: the response sets no cookie.
      expect(text()).toContain("Page views are counted, without cookies.");
    });

    it("says nothing is stored in the browser", () => {
      // use-traffic.test.tsx: "touches neither cookies nor browser storage".
      expect(text()).toContain("Nothing is stored in your browser");
    });

    it("says the record is never connected to an account", () => {
      // traffic-privacy.test.ts: the writer's import graph never reaches
      // Better Auth or #/lib/auth, and the table has no user column.
      expect(text()).toContain(
        "never connected to your account, even when you are signed in"
      );
    });

    it("says the IP address is not included", () => {
      // traffic.integration.test.ts: an inserted row never contains the
      // request's address. traffic-privacy.test.ts: no address column.
      expect(text()).toContain("It does not include your IP address.");
    });

    it("says the daily value is replaced and discarded, so days never connect", () => {
      // traffic.integration.test.ts: the salt is replaced on a new day, one
      // row only, in an UNLOGGED table.
      expect(text()).toContain(
        "a random value that is replaced every day and then discarded"
      );
      expect(text()).toContain("never connected across days");
    });

    it("says pages that require signing in are not counted", () => {
      // traffic-scope.test.ts: the predicate refuses every route outside
      // _public; use-traffic.test.tsx: a signed-in route sends nothing.
      expect(text()).toContain(
        "Pages that require signing in are not counted."
      );
    });

    it("names the access log retention the infrastructure actually sets", () => {
      const days =
        /variable "access_log_retention_days" \{[^}]*default\s*=\s*(\d+)/.exec(
          readFileSync(join(process.cwd(), "infra/variables.tf"), "utf8")
        )?.[1];
      expect(days).toBeDefined();
      expect(text()).toContain(
        `which do include IP addresses, for ${days} days.`
      );
    });
  });

  it("links the support address from the brand", () => {
    render(<PrivacyPolicy />);
    // The address itself is brand config, not this component's business: a
    // rebrand must not red a component test. The href is what this owns.
    const link = screen.getByRole("link", { name: brand.supportEmail });
    expect(link.getAttribute("href")).toBe(`mailto:${brand.supportEmail}`);
  });
});
