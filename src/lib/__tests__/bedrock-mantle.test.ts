import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mantleHost,
  mantleRegion,
  mantleResponses,
  RESPONSES_PATH,
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
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json({ status: "completed" }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    await mantleResponses({ model: "m" });

    expect(timeout).toHaveBeenCalledWith(60_000);
    const init = fetchSpy.mock.calls[0]?.at(1) as RequestInit;
    expect(init.signal).toBe(timeout.mock.results[0]?.value);
  });
});
