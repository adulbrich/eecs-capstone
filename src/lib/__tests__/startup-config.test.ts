import { describe, expect, it } from "vitest";
import {
  assertProductionConfig,
  missingProductionConfig,
} from "../_internal/startup-config";

// Obvious fakes throughout. Three of these variables are secrets in
// production, so nothing here may look like one.
const complete = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://fake:fake@localhost:5432/fake",
  BETTER_AUTH_URL: "https://example.test",
  BETTER_AUTH_SECRET: "not-a-real-secret",
  ONID_DISCOVERY_URL: "https://example.test/.well-known/openid-configuration",
  ONID_CLIENT_ID: "not-a-real-client-id",
  ONID_CLIENT_SECRET: "not-a-real-client-secret",
  S3_BUCKET: "not-a-real-bucket",
} as NodeJS.ProcessEnv;

describe("missingProductionConfig", () => {
  it("is silent outside production, whatever is unset", () => {
    expect(missingProductionConfig({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      missingProductionConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv)
    ).toEqual([]);
    expect(
      missingProductionConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  it("finds nothing when everything is set", () => {
    expect(missingProductionConfig(complete)).toEqual([]);
  });

  it("names exactly the unset variables, in one fixed order", () => {
    const {
      ONID_CLIENT_SECRET: _secret,
      S3_BUCKET: _bucket,
      ...rest
    } = complete;
    expect(
      missingProductionConfig({
        ...rest,
        DATABASE_URL: "",
      } as NodeJS.ProcessEnv)
    ).toEqual(["DATABASE_URL", "ONID_CLIENT_SECRET", "S3_BUCKET"]);
  });

  it("treats whitespace as unset, the way warnUnconfiguredProviders does", () => {
    expect(
      missingProductionConfig({
        ...complete,
        BETTER_AUTH_SECRET: "   ",
      } as NodeJS.ProcessEnv)
    ).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("leaves the GitHub credentials to the warning", () => {
    // Optional in production: infra/variables.tf defaults the id to empty.
    expect(
      missingProductionConfig({
        ...complete,
        GITHUB_CLIENT_ID: "",
        GITHUB_CLIENT_SECRET: "",
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });
});

describe("assertProductionConfig", () => {
  it("returns when nothing is missing", () => {
    expect(() => assertProductionConfig(complete)).not.toThrow();
  });

  it("throws once, naming every missing variable and no value", () => {
    const env = {
      ...complete,
      BETTER_AUTH_SECRET: "leaked-if-this-appears",
      ONID_CLIENT_ID: "",
      S3_BUCKET: undefined,
    } as NodeJS.ProcessEnv;
    let message = "";
    try {
      assertProductionConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("ONID_CLIENT_ID, S3_BUCKET are not set");
    expect(message).not.toContain("leaked-if-this-appears");
    expect(message).not.toContain("not-a-real");
  });

  it("uses the singular for one missing variable", () => {
    expect(() =>
      assertProductionConfig({
        ...complete,
        S3_BUCKET: "",
      } as NodeJS.ProcessEnv)
    ).toThrow(/S3_BUCKET is not set/);
  });
});
