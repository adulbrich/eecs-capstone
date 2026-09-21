import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { describe, expect, it } from "vitest";
import { buildAuthConfig } from "../_internal/auth-config";

// `@better-auth/core` is a dependency of the pinned `better-auth`, not of this
// package, and this is the resolver `auth.ts` hands `trustedProxies` to. The
// test pins the contract the config relies on, so a Better Auth bump that
// changes how the chain is walked fails here rather than in production.

/**
 * What `X-Forwarded-For` looks like at the task.
 *
 * `infra/ecs.tf` sets `xff_header_processing_mode = "preserve"` on the load
 * balancer, so the ALB adds nothing and the task sees exactly what CloudFront
 * sent. CloudFront's rule is documented and unconditional: it takes the viewer
 * address from the TCP connection and appends it. So the LAST entry is always
 * the viewer, and anything the viewer prepended sits to its left.
 *
 * This fixture used to hand-write a VPC origin ENI as the last hop, on the
 * theory that the ALB appended one. It does not; it appended a CloudFront edge
 * server's public address, which is what #535 was about. The test passed
 * anyway, because it invented its own chain: it pins Better Auth's walk
 * correctly and says nothing about what AWS actually sends. That limitation is
 * unchanged, so treat a green run here as evidence about Better Auth only. The
 * check that speaks to AWS is the post-deploy one in DEPLOYMENT.md: sign in and
 * read `session.ipAddress`.
 */
const VIEWER = "198.51.100.7";
const SPOOFED = "203.0.113.9";

/** Never matched by anything in the chain, which is the point of the walk. */
const TRUSTED = "10.0.0.0/16";

describe("resolving the viewer behind CloudFront under preserve", () => {
  it("takes the viewer from a single-entry chain", () => {
    const { trustedProxies } = buildAuthConfig({
      TRUSTED_PROXY_CIDR: TRUSTED,
    } as NodeJS.ProcessEnv);
    expect(
      getIPFromHeader(VIEWER, { trustedProxies: [...trustedProxies] })
    ).toBe(VIEWER);
  });

  it("ignores anything the viewer prepended, because CloudFront appends after it", () => {
    expect(
      getIPFromHeader(`${SPOOFED}, ${VIEWER}`, { trustedProxies: [TRUSTED] })
    ).toBe(VIEWER);
  });

  it("still ignores a prepended chain of several spoofed entries", () => {
    expect(
      getIPFromHeader(`${SPOOFED}, 192.0.2.1, 192.0.2.2, ${VIEWER}`, {
        trustedProxies: [TRUSTED],
      })
    ).toBe(VIEWER);
  });

  it("resolves nothing with no trusted proxies once a viewer prepends, which is why the variable stays required", () => {
    // This is the failure the non-empty rule exists to prevent. With an empty
    // trusted list Better Auth believes only a single-entry header, so a viewer
    // sitting behind their own corporate or campus proxy, which adds its own
    // X-Forwarded-For, collapses into the shared `no-trusted-ip` bucket (#519).
    const { trustedProxies } = buildAuthConfig({} as NodeJS.ProcessEnv);
    expect(
      getIPFromHeader(`${SPOOFED}, ${VIEWER}`, {
        trustedProxies: [...trustedProxies],
      })
    ).toBeNull();
  });

  it("skips an entry that IS inside the trusted range, which is the forgery bound", () => {
    // Nothing in the real chain sits in `var.vpc_cidr`, so this case is not
    // production traffic. It pins the property that makes the residual risk in
    // `infra/ecs.tf` what it is: a caller already inside the VPC can prepend
    // whatever it likes and be believed, because its own address is trusted and
    // gets skipped. That was equally true before `preserve` and is bounded by
    // the ALB being internal, not by this walk.
    const insideTheVpc = "10.0.5.5";
    expect(
      getIPFromHeader(`${SPOOFED}, ${insideTheVpc}`, {
        trustedProxies: [TRUSTED],
      })
    ).toBe(SPOOFED);
  });
});
