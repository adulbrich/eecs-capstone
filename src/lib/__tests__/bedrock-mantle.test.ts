import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFailureReason,
  mantleHost,
  mantleRegion,
  mantleResponses,
  RESPONSES_PATH,
  redactSignedValues,
} from "../_internal/bedrock-mantle";

describe("mantleRegion", () => {
  it("reads BEDROCK_REGION and falls back to us-east-1", () => {
    expect(mantleRegion({ BEDROCK_REGION: "us-west-2" })).toBe("us-west-2");
    expect(mantleRegion({})).toBe("us-east-1");
  });
});

describe("mantleHost", () => {
  it("builds the api.aws host, not the amazonaws.com runtime one", () => {
    expect(mantleHost("us-east-1")).toBe("bedrock-mantle.us-east-1.api.aws");
  });
});

describe("RESPONSES_PATH", () => {
  it("uses the /openai/v1 prefix the GPT models are served under", () => {
    expect(RESPONSES_PATH).toBe("/openai/v1/responses");
  });
});

describe("mantleResponses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gives up after 60 s rather than waiting out undici's 300 s", async () => {
    // Static keys, so the signer never walks the credential chain.
    vi.stubEnv("BEDROCK_ACCESS_KEY", "AKIDEXAMPLE");
    vi.stubEnv("BEDROCK_SECRET_KEY", "secret");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(Response.json({ status: "completed" }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    await mantleResponses({ model: "m" });

    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(fetchSpy.mock.calls[0]?.[1].signal).toBe(
      timeout.mock.results[0]?.value
    );
  });

  it("names the cause when the request fails and when the body dies mid-read", async () => {
    vi.stubEnv("BEDROCK_ACCESS_KEY", "AKIDEXAMPLE");
    vi.stubEnv("BEDROCK_SECRET_KEY", "secret");
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
        code: "ECONNREFUSED",
      }),
    });
    vi.stubGlobal("fetch", () => Promise.reject(refused));
    await expect(mantleResponses({ model: "m" })).rejects.toThrow(
      "Bedrock Mantle request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 10.0.0.1:443)"
    );

    const closed = new TypeError("terminated", {
      cause: Object.assign(new Error("other side closed"), {
        code: "UND_ERR_SOCKET",
      }),
    });
    const cutOff = { ok: true, json: () => Promise.reject(closed) };
    vi.stubGlobal("fetch", () => Promise.resolve(cutOff));
    await expect(mantleResponses({ model: "m" })).rejects.toThrow(
      "Bedrock Mantle response failed: terminated (UND_ERR_SOCKET: other side closed)"
    );

    const errorCutOff = {
      ok: false,
      status: 500,
      text: () => Promise.reject(closed),
    };
    vi.stubGlobal("fetch", () => Promise.resolve(errorCutOff));
    await expect(mantleResponses({ model: "m" })).rejects.toThrow(
      "Bedrock Mantle response failed: terminated (UND_ERR_SOCKET: other side closed)"
    );
  });
});

/**
 * A token carrying all three characters base64 adds to the alphabet, so each
 * escaping below has something to change.
 */
const TOKEN = "IQoJb3JpZ2luX2VjE/abc+def/ghi==";
const AUTH =
  "AWS4-HMAC-SHA256 Credential=ASIAEXAMPLE/20260928/us-east-1/bedrock-mantle/aws4_request, SignedHeaders=host;x-amz-security-token, Signature=0f0f";
const SIGNED = {
  authorization: AUTH,
  host: "bedrock-mantle.us-east-1.api.aws",
  "x-amz-security-token": TOKEN,
};

describe("redactSignedValues", () => {
  const escapedSlash = (value: string) => value.replaceAll("/", "\\/");
  it.each([
    [
      "a canonical request",
      `POST\r\n/openai/v1/responses\r\nhost:h\r\nx-amz-security-token:${TOKEN}\r\n`,
    ],
    [
      "a query string",
      `X-Amz-Security-Token=${encodeURIComponent(TOKEN)}&X-Amz-Date=d`,
    ],
    [
      "a lower-case percent-encoding",
      `t=${encodeURIComponent(TOKEN).replace(/%[0-9A-F]{2}/g, (e) => e.toLowerCase())}`,
    ],
    [
      "JSON",
      JSON.stringify({ "x-amz-security-token": TOKEN, Authorization: AUTH }),
    ],
    [
      "JSON inside a JSON string",
      JSON.stringify({
        message: JSON.stringify({ "x-amz-security-token": TOKEN }),
      }),
    ],
    ["JSON with `/` as `\\/`", `{"t":"${escapedSlash(TOKEN)}"}`],
    [
      "JSON with `/` as `\\u002f`",
      `{"t":"${TOKEN.replaceAll("/", "\\u002f")}"}`,
    ],
    ["a Python repr", `{'x-amz-security-token': '${TOKEN}'}`],
  ])("leaves no piece of either value in %s", (_framing, body) => {
    const redacted = redactSignedValues(body, SIGNED);
    expect(redacted).toContain("[redacted]");
    for (const piece of [
      "IQoJb3JpZ2luX2VjE",
      "abc+def",
      "ghi==",
      "ASIAEXAMPLE",
      "Signature=0f0f",
    ]) {
      expect(redacted).not.toContain(piece);
    }
  });

  it("leaves the rest of the body alone, including the host it signed", () => {
    expect(
      redactSignedValues(
        "The security token included is invalid. host:bedrock-mantle.us-east-1.api.aws",
        SIGNED
      )
    ).toBe(
      "The security token included is invalid. host:bedrock-mantle.us-east-1.api.aws"
    );
  });
});

describe("fetchFailureReason", () => {
  it("names the undici code a bare 'fetch failed' hides on its cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND host"), {
      code: "ENOTFOUND",
    });
    expect(fetchFailureReason(new TypeError("fetch failed", { cause }))).toBe(
      "fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND host)"
    );
  });

  it("reads the first address's error when every address refused", () => {
    const cause = Object.assign(
      // biome-ignore lint/suspicious/useErrorMessage: undici builds it with an empty message, which is the case under test
      new AggregateError([new Error("connect ECONNREFUSED ::1:443")], ""),
      { code: "ECONNREFUSED" }
    );
    expect(fetchFailureReason(new TypeError("fetch failed", { cause }))).toBe(
      "fetch failed (ECONNREFUSED: connect ECONNREFUSED ::1:443)"
    );
  });

  it("keeps the message alone when there is no cause, as for our own timeout", () => {
    const timeout = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError"
    );
    expect(fetchFailureReason(timeout)).toBe(
      "The operation was aborted due to timeout"
    );
  });
});
