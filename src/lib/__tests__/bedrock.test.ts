import { describe, expect, it } from "vitest";
import { getBedrockClient } from "../_internal/bedrock";

describe("getBedrockClient", () => {
  it("returns the same instance on repeated calls", () => {
    expect(getBedrockClient()).toBe(getBedrockClient());
  });
});
