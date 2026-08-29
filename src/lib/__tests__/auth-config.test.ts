import { describe, expect, it, vi } from "vitest";
import {
  buildAuthConfig,
  warnUnconfiguredProviders,
} from "../_internal/auth-config";

// Obvious fakes only. Two of these variables hold real secrets in a real
// deployment, and a test fixture that looks like a credential is one careless
// copy away from being treated as one.
const CONFIGURED = {
  GITHUB_CLIENT_ID: "gh-id-fake",
  GITHUB_CLIENT_SECRET: "gh-secret-fake",
  ONID_CLIENT_ID: "onid-id-fake",
  ONID_CLIENT_SECRET: "onid-secret-fake",
  ONID_DISCOVERY_URL:
    "https://login.microsoftonline.com/tenant-guid-fake/v2.0/.well-known/openid-configuration",
} as NodeJS.ProcessEnv;

describe("buildAuthConfig", () => {
  it("reports every unset provider credential by name", () => {
    const config = buildAuthConfig({} as NodeJS.ProcessEnv);
    expect(config.unconfigured).toEqual([
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "ONID_DISCOVERY_URL",
      "ONID_CLIENT_ID",
      "ONID_CLIENT_SECRET",
    ]);
  });

  it("reports nothing unconfigured when every credential is set", () => {
    expect(buildAuthConfig(CONFIGURED).unconfigured).toEqual([]);
  });

  it("reports a whitespace-only credential as unset but passes it through untrimmed", () => {
    // The task definition passes empty strings for variables terraform has no
    // value for, so blank is the shape a missing credential actually arrives in.
    //
    // Both halves are asserted because they disagree, and the disagreement is
    // deliberate: reporting trims, the value does not. Trimming the value would
    // be a behaviour change inside a refactor. See #137.
    const config = buildAuthConfig({
      ...CONFIGURED,
      GITHUB_CLIENT_SECRET: "   ",
    } as NodeJS.ProcessEnv);
    expect(config.unconfigured).toEqual(["GITHUB_CLIENT_SECRET"]);
    expect(config.github.clientSecret).toBe("   ");
  });

  it("derives the ONID issuer from the discovery URL", () => {
    const config = buildAuthConfig(CONFIGURED);
    expect(config.onid.issuer).toBe(
      "https://login.microsoftonline.com/tenant-guid-fake/v2.0"
    );
  });

  it("derives an empty issuer from an unset discovery URL, so ONID fails closed", () => {
    expect(buildAuthConfig({} as NodeJS.ProcessEnv).onid.issuer).toBe("");
  });

  it("turns secure cookies on only in production", () => {
    expect(
      buildAuthConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
        .isProduction
    ).toBe(true);
    expect(
      buildAuthConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv).isProduction
    ).toBe(false);
  });

  it("trusts the host everywhere except development", () => {
    // Not the same predicate as isProduction: they agree under development
    // and production and disagree under everything else, unset included, as
    // the unset case below shows. Deployed code never lands in that gap
    // because the Dockerfile and the task definition both set production.
    // Pinned here so closing the gap has to be deliberate. See the Better
    // Auth section of docs/QUIRKS.md.
    expect(
      buildAuthConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv)
        .trustHost
    ).toBe(false);
    expect(
      buildAuthConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv).trustHost
    ).toBe(true);
    const unset = buildAuthConfig({} as NodeJS.ProcessEnv);
    expect(unset.trustHost).toBe(true);
    expect(unset.isProduction).toBe(false);
  });

  it("defaults every credential to an empty string rather than undefined", () => {
    // Better Auth's provider config types demand strings, and the empty string
    // is what the previous inline reads produced. The seam changes where the
    // fallback lives, not what it is.
    const config = buildAuthConfig({} as NodeJS.ProcessEnv);
    expect(config.github).toEqual({ clientId: "", clientSecret: "" });
    expect(config.onid.clientId).toBe("");
    expect(config.onid.clientSecret).toBe("");
    expect(config.onid.discoveryUrl).toBe("");
  });
});

describe("warnUnconfiguredProviders", () => {
  it("names the missing variables without logging their values", () => {
    const warn = vi.fn();
    const config = buildAuthConfig({
      ...CONFIGURED,
      ONID_CLIENT_SECRET: "",
    } as NodeJS.ProcessEnv);
    warnUnconfiguredProviders(config.unconfigured, warn);
    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("ONID_CLIENT_SECRET");
    expect(message).not.toContain("onid-id-fake");
    expect(message).not.toContain("gh-secret-fake");
  });

  it("stays quiet when everything is configured", () => {
    const warn = vi.fn();
    warnUnconfiguredProviders(buildAuthConfig(CONFIGURED).unconfigured, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
