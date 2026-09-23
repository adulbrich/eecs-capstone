import { describe, expect, it } from "vitest";
import {
  describeAgent,
  readCappedBody,
  referrerHost,
  trafficBodySchema,
  viewerAddress,
  viewerCountry,
  visitorHash,
} from "#/lib/_internal/traffic-request";

const TRUSTED = ["10.0.0.0/16"];
const VIEWER = "198.51.100.7";
const SPOOFED = "203.0.113.9";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME_ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

// Under `preserve` the ALB adds nothing, so the last entry is CloudFront's
// append of the viewer (#556). The rule on #506, index `length - 2`, is
// obsolete and would drop every event; these pin the one that replaced it.
describe("viewerAddress", () => {
  it("takes a single entry", () => {
    expect(viewerAddress(VIEWER, TRUSTED)).toBe(VIEWER);
  });

  it("takes the last entry of a chain the viewer prepended to", () => {
    expect(viewerAddress(`${SPOOFED}, 192.0.2.1, ${VIEWER}`, TRUSTED)).toBe(
      VIEWER
    );
  });

  it("walks left past an entry inside TRUSTED_PROXY_CIDR", () => {
    expect(viewerAddress(`${VIEWER}, 10.0.5.5`, TRUSTED)).toBe(VIEWER);
  });

  it("covers repeated header lines, which Node joins with a comma", () => {
    expect(viewerAddress(`${SPOOFED},${VIEWER}`, TRUSTED)).toBe(VIEWER);
  });

  it("reduces IPv6 to its /64", () => {
    expect(viewerAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd", TRUSTED)).toBe(
      "2001:0db8:0001:0002:0000:0000:0000:0000"
    );
    expect(viewerAddress("2001:db8:1:2::9", TRUSTED)).toBe(
      viewerAddress("2001:db8:1:2:ffff::1", TRUSTED)
    );
  });

  it("resolves nothing, so the event drops, without a valid address", () => {
    expect(viewerAddress(null, TRUSTED)).toBeNull();
    expect(viewerAddress("", TRUSTED)).toBeNull();
    expect(viewerAddress("not-an-address", TRUSTED)).toBeNull();
    expect(viewerAddress("10.0.0.1, 10.0.0.2", TRUSTED)).toBeNull();
  });
});

describe("viewerCountry", () => {
  it("stores a two-letter code", () => {
    expect(viewerCountry("US")).toBe("US");
  });

  it("stores null for a duplicated header, a lowercase or long value, or none", () => {
    expect(viewerCountry("US, GB")).toBeNull();
    expect(viewerCountry("usa")).toBeNull();
    expect(viewerCountry("us")).toBeNull();
    expect(viewerCountry(null)).toBeNull();
  });
});

describe("referrerHost", () => {
  it("keeps the host and nothing else", () => {
    expect(
      referrerHost("https://www.google.com/search?q=capstone#x", "eecs.example")
    ).toBe("www.google.com");
  });

  it("drops the site's own host, an unparseable value and none", () => {
    expect(
      referrerHost("https://eecs.example/projects?q=a", "eecs.example")
    ).toBeNull();
    expect(referrerHost("not a url", "eecs.example")).toBeNull();
    expect(referrerHost(undefined, "eecs.example")).toBeNull();
  });
});

describe("describeAgent", () => {
  it("keeps families and the device class", () => {
    expect(describeAgent(SAFARI_IPHONE)).toEqual({
      browser: "Safari",
      browserMajor: "17",
      device: "mobile",
      os: "iOS",
    });
    expect(describeAgent(CHROME_ANDROID_TABLET).device).toBe("tablet");
  });

  it("returns nulls for what it cannot read", () => {
    expect(describeAgent("x")).toEqual({
      browser: null,
      browserMajor: null,
      device: null,
      os: null,
    });
  });
});

describe("visitorHash", () => {
  const agent = describeAgent(SAFARI_MAC);

  it("is 16 bytes of base64url and never contains the address", () => {
    const hash = visitorHash("salt-a", VIEWER, agent);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(hash).not.toContain(VIEWER);
  });

  it("is stable within a salt and unrelated across salts", () => {
    expect(visitorHash("salt-a", VIEWER, agent)).toBe(
      visitorHash("salt-a", VIEWER, agent)
    );
    expect(visitorHash("salt-a", VIEWER, agent)).not.toBe(
      visitorHash("salt-b", VIEWER, agent)
    );
  });

  it("separates two browsers behind one address", () => {
    expect(visitorHash("salt-a", VIEWER, agent)).not.toBe(
      visitorHash("salt-a", VIEWER, describeAgent(SAFARI_IPHONE))
    );
  });
});

describe("trafficBodySchema", () => {
  it("accepts a view with a validated search", () => {
    const parsed = trafficBodySchema.parse({
      kind: "view",
      pathname: "/projects",
      search: { q: "robot", categories: [], page: 1, archivedOnly: false },
    });
    expect(parsed.search?.q).toBe("robot");
  });

  it("trims the typed search and cuts it to 100 characters", () => {
    const parsed = trafficBodySchema.parse({
      kind: "search",
      pathname: "/projects",
      search: { q: `  ${"a".repeat(150)}  ` },
    });
    expect(parsed.search?.q).toBe("a".repeat(100));
  });

  it("refuses a pathname that is relative or too long", () => {
    expect(
      trafficBodySchema.safeParse({ kind: "view", pathname: "projects" })
        .success
    ).toBe(false);
    expect(
      trafficBodySchema.safeParse({
        kind: "view",
        pathname: `/${"a".repeat(512)}`,
      }).success
    ).toBe(false);
  });

  it("refuses an unknown kind and an oversized search value", () => {
    expect(
      trafficBodySchema.safeParse({ kind: "click", pathname: "/" }).success
    ).toBe(false);
    expect(
      trafficBodySchema.safeParse({
        kind: "view",
        pathname: "/",
        search: { cols: "a".repeat(300) },
      }).success
    ).toBe(false);
  });
});

describe("readCappedBody", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/traffic", {
      method: "POST",
      body,
      headers,
    });

  it("reads a body under the cap", async () => {
    expect(await readCappedBody(post("{}"))).toBe("{}");
  });

  it("refuses a body over the cap even when Content-Length is absent", async () => {
    expect(await readCappedBody(post("x".repeat(5000)))).toBeNull();
  });

  it("refuses a declared length over the cap without reading", async () => {
    expect(
      await readCappedBody(post("{}", { "content-length": "999999" }))
    ).toBeNull();
  });
});
