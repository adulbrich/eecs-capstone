import { describe, expect, it } from "vitest";
import {
  mantleHost,
  mantleRegion,
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
