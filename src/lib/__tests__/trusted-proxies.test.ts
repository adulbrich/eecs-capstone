import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { describe, expect, it } from "vitest";
import { buildAuthConfig } from "../_internal/auth-config";

// `@better-auth/core` is a dependency of the pinned `better-auth`, not of this
// package, and this is the resolver `auth.ts` hands `trustedProxies` to. The
// test pins the contract the config relies on, so a Better Auth bump that
// changes how the chain is walked fails here rather than in production.

/**
 * What `X-Forwarded-For` looks like at the task. The viewer sends the request
 * to CloudFront, which appends the viewer's address; the ALB appends
 * CloudFront's VPC origin ENI, which sits inside `var.vpc_cidr`. So the header
 * always carries at least two entries and the viewer is the one before the
 * last. A viewer can prepend anything, which is the leftmost entry below.
 */
const VIEWER = "198.51.100.7";
const VPC_ORIGIN_ENI = "10.0.12.34";
const SPOOFED = "203.0.113.9";

const CHAIN = `${SPOOFED}, ${VIEWER}, ${VPC_ORIGIN_ENI}`;

describe("resolving the viewer behind CloudFront and the ALB", () => {
  it("returns the viewer, skipping the VPC hop and ignoring a prepended spoof", () => {
    const { trustedProxies } = buildAuthConfig({
      TRUSTED_PROXY_CIDR: "10.0.0.0/16",
    } as NodeJS.ProcessEnv);
    expect(
      getIPFromHeader(CHAIN, { trustedProxies: [...trustedProxies] })
    ).toBe(VIEWER);
  });

  it("returns the viewer from the two-entry chain a viewer with no spoof produces", () => {
    expect(
      getIPFromHeader(`${VIEWER}, ${VPC_ORIGIN_ENI}`, {
        trustedProxies: ["10.0.0.0/16"],
      })
    ).toBe(VIEWER);
  });

  it("resolves nothing from the same chain with no trusted proxies, which is the bug", () => {
    // With nothing to skip, Better Auth trusts only a single-entry header. The
    // chain behind CloudFront and the ALB never has one, so every request in
    // production resolved to null and shared the "no-trusted-ip" bucket (#519).
    const { trustedProxies } = buildAuthConfig({} as NodeJS.ProcessEnv);
    expect(
      getIPFromHeader(CHAIN, { trustedProxies: [...trustedProxies] })
    ).toBeNull();
  });

  it("takes the last hop itself when it is outside the trusted range", () => {
    // Nothing left of an untrusted hop can be believed, so a chain that did
    // not end inside the VPC resolves to whoever handed it over, never to the
    // entry they prepended.
    expect(
      getIPFromHeader(`${SPOOFED}, ${VIEWER}`, {
        trustedProxies: ["10.0.0.0/16"],
      })
    ).toBe(VIEWER);
  });
});
