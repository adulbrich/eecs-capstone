import { describe, expect, it } from "vitest";
import { buildBedrockConfig } from "../_internal/bedrock";
import { buildS3Config } from "../_internal/storage";

describe("buildS3Config", () => {
  it("omits credentials when no static keys are set (prod uses the task role)", () => {
    const cfg = buildS3Config({ S3_REGION: "us-west-2" } as NodeJS.ProcessEnv);
    expect(cfg.credentials).toBeUndefined();
    expect(cfg.region).toBe("us-west-2");
    expect(cfg.endpoint).toBeUndefined();
  });

  it("includes credentials and path-style endpoint for local S3-compatible storage", () => {
    const cfg = buildS3Config({
      S3_ENDPOINT: "http://localhost:9000",
      S3_ACCESS_KEY: "ak",
      S3_SECRET_KEY: "sk",
    } as NodeJS.ProcessEnv);
    expect(cfg.endpoint).toBe("http://localhost:9000");
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.credentials).toEqual({
      accessKeyId: "ak",
      secretAccessKey: "sk",
    });
  });
});

describe("buildBedrockConfig", () => {
  it("omits credentials when no static keys are set (prod uses the task role)", () => {
    const cfg = buildBedrockConfig({
      BEDROCK_REGION: "us-west-2",
    } as NodeJS.ProcessEnv);
    expect(cfg.credentials).toBeUndefined();
    expect(cfg.region).toBe("us-west-2");
  });

  it("includes credentials when static keys are set", () => {
    const cfg = buildBedrockConfig({
      BEDROCK_ACCESS_KEY: "ak",
      BEDROCK_SECRET_KEY: "sk",
    } as NodeJS.ProcessEnv);
    expect(cfg.credentials).toEqual({
      accessKeyId: "ak",
      secretAccessKey: "sk",
    });
  });
});
