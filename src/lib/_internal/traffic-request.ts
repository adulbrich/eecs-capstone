import { createHash } from "node:crypto";
// The IP walk Better Auth itself runs for `session.ipAddress`, from its core
// package, which holds no session or account code. `trusted-proxies.test.ts`
// pins its contract. Importing `better-auth` or `#/lib/auth` from the traffic
// writer is refused by `traffic-privacy.test.ts`; this module is not either.
import { getIPFromHeader } from "@better-auth/core/utils/ip";
import Bowser from "bowser";
import { z } from "zod";

/**
 * Everything the traffic writer derives from one request, as pure functions
 * so the unit tests can hold each rule on its own. Server-only: it hashes
 * with `node:crypto`. The handler that strings them together is
 * `src/server/_internal/traffic-writer.ts`.
 */

/** Largest body `/api/traffic` reads before giving up (#510). */
export const MAX_BODY_BYTES = 4096;
const MAX_PATH = 512;
const MAX_QUERY = 100;
const MAX_STRING = 256;
const MAX_REFERRER = 2048;
const MAX_SEARCH_KEYS = 30;
const MAX_ARRAY = 20;

const searchString = z.string().max(MAX_STRING);
const searchValue = z.union([
  searchString,
  z.number(),
  z.boolean(),
  z.null(),
  z.array(searchString).max(MAX_ARRAY),
]);

const path = z.string().startsWith("/").max(MAX_PATH);

export const trafficBodySchema = z.object({
  kind: z.enum(["view", "search"]),
  pathname: path,
  previousPath: path.optional(),
  referrer: z.string().max(MAX_REFERRER).optional(),
  search: z
    .record(z.string().max(64), searchValue)
    .refine((s) => Object.keys(s).length <= MAX_SEARCH_KEYS)
    // The typed search is the one free-text field. It is trimmed and cut
    // rather than refused, so a long query still counts as a search.
    .transform((s) =>
      typeof s.q === "string" ? { ...s, q: s.q.trim().slice(0, MAX_QUERY) } : s
    )
    .optional(),
});

export type TrafficRequestBody = z.infer<typeof trafficBodySchema>;

/**
 * The body as text, or null when it is over `MAX_BODY_BYTES`. A declared
 * `Content-Length` over the cap is refused unread, and the stream is counted
 * as it arrives, because the header can be absent or lie.
 */
export async function readCappedBody(
  request: Request,
  maxBytes = MAX_BODY_BYTES
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) {
    return null;
  }
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The viewer's address from `X-Forwarded-For`, or null when none can be
 * trusted, in which case the event is dropped.
 *
 * The ALB runs in `preserve` (#556), so the last entry is CloudFront's
 * append, which is the viewer; anything to its left was sent by the viewer.
 * The walk skips entries inside `TRUSTED_PROXY_CIDR` from the right, the
 * same walk Better Auth does. Node joins repeated header lines with `, `, so
 * a split on commas covers both. IPv6 comes back reduced to its /64, the
 * part that identifies a household rather than a device, and an IPv4-mapped
 * address comes back as IPv4.
 */
export function viewerAddress(
  forwardedFor: string | null,
  trustedProxies: readonly string[]
): string | null {
  if (!forwardedFor) {
    return null;
  }
  return getIPFromHeader(forwardedFor, {
    ipv6Subnet: 64,
    trustedProxies: [...trustedProxies],
  });
}

const COUNTRY = /^[A-Z]{2}$/;

/**
 * `CloudFront-Viewer-Country`, only when it is exactly two capital letters.
 * A duplicated header joins to `"US, GB"` and fails, which is the point.
 * Trustworthy only once #590 attaches the policy that makes CloudFront set
 * it; before that any value here was sent by the viewer.
 */
export function viewerCountry(header: string | null): string | null {
  return header !== null && COUNTRY.test(header) ? header : null;
}

/**
 * The referring site's host, or null for none, an unparseable value, or the
 * site itself. No path and no query ever leave this function.
 */
export function referrerHost(
  referrer: string | undefined,
  ownHost: string
): string | null {
  if (!referrer) {
    return null;
  }
  let host: string;
  try {
    host = new URL(referrer).host.toLowerCase();
  } catch {
    return null;
  }
  return host && host !== ownHost.toLowerCase() ? host : null;
}

export type TrafficDevice = "desktop" | "mobile" | "tablet";

export interface AgentDescription {
  browser: string | null;
  browserMajor: string | null;
  device: TrafficDevice | null;
  os: string | null;
}

const DEVICES: readonly string[] = ["desktop", "mobile", "tablet"];

/**
 * Families only, from `bowser` (#505). The major version is a hash input and
 * is never stored. An iPad reads as a macOS desktop; accepted (#508).
 */
export function describeAgent(userAgent: string): AgentDescription {
  const parsed = Bowser.parse(userAgent);
  const type = parsed.platform.type ?? "";
  return {
    browser: parsed.browser.name || null,
    browserMajor: parsed.browser.version?.split(".")[0] || null,
    device: DEVICES.includes(type) ? (type as TrafficDevice) : null,
    os: parsed.os.name || null,
  };
}

/**
 * SHA-256 over the day's salt, the viewer address and the agent's families,
 * truncated to 16 bytes and base64url-encoded (ADR-0048). The salt is
 * replaced daily and never kept, so a hash cannot be linked to the same
 * visitor on another day by anyone. Fields are newline-joined so no two
 * different inputs concatenate to the same string.
 */
export function visitorHash(
  salt: string,
  address: string,
  agent: AgentDescription
): string {
  return createHash("sha256")
    .update(
      [
        salt,
        address,
        agent.browser ?? "",
        agent.browserMajor ?? "",
        agent.os ?? "",
        agent.device ?? "",
      ].join("\n")
    )
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}
