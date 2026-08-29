import { describe, expect, it } from "vitest";
import { buildEmailSenderConfig, buildNotificationConfig } from "../config";

describe("buildEmailSenderConfig", () => {
  it("defaults to the console transport so a bare checkout sends nowhere", () => {
    const config = buildEmailSenderConfig({} as NodeJS.ProcessEnv);
    expect(config.transport).toBe("console");
    expect(config.from).toBeNull();
    expect(config.replyTo).toBeNull();
  });

  it("prefers SES_REGION, falls back to AWS_REGION, then to us-east-1", () => {
    const at = (env: NodeJS.ProcessEnv) => buildEmailSenderConfig(env).region;
    expect(
      at({
        SES_REGION: "us-west-2",
        AWS_REGION: "eu-west-1",
      } as NodeJS.ProcessEnv)
    ).toBe("us-west-2");
    // AWS_REGION is the SDK's own variable and is set on ECS whether or not
    // anyone configures SES, so it has to win over the hardcoded default.
    expect(at({ AWS_REGION: "eu-west-1" } as NodeJS.ProcessEnv)).toBe(
      "eu-west-1"
    );
    expect(at({} as NodeJS.ProcessEnv)).toBe("us-east-1");
  });

  it("treats a blank value as unset, because that is how the task definition sends one", () => {
    // infra/ecs.tf passes EMAIL_REPLY_TO as an empty string until an address
    // is decided, so blank has to mean absent or the header goes out empty.
    const config = buildEmailSenderConfig({
      EMAIL_FROM: "   ",
      EMAIL_REPLY_TO: "",
    } as NodeJS.ProcessEnv);
    expect(config.from).toBeNull();
    expect(config.replyTo).toBeNull();
  });

  it("trims a configured address rather than passing the padding through", () => {
    const config = buildEmailSenderConfig({
      EMAIL_FROM: " noreply@example.edu ",
      EMAIL_REPLY_TO: " replies@example.edu ",
    } as NodeJS.ProcessEnv);
    expect(config.from).toBe("noreply@example.edu");
    expect(config.replyTo).toBe("replies@example.edu");
  });

  it("does not throw on a missing EMAIL_FROM under the ses transport", () => {
    // The throw belongs to createSesEmailSender, not here: getEmailSender()
    // runs at module scope in src/lib/auth.ts, so a throw in this builder
    // would fail the app's boot on every transport rather than just SES.
    expect(() =>
      buildEmailSenderConfig({ EMAIL_TRANSPORT: "ses" } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});

describe("buildNotificationConfig", () => {
  it("reports an unset app base url and review inbox as null", () => {
    const config = buildNotificationConfig({} as NodeJS.ProcessEnv);
    expect(config.appBaseUrl).toBeNull();
    expect(config.reviewInbox).toBeNull();
  });

  it("trims both, and treats blank as unset", () => {
    expect(
      buildNotificationConfig({
        BETTER_AUTH_URL: " https://app ",
        EMAIL_REVIEW_INBOX: "  ",
      } as NodeJS.ProcessEnv)
    ).toEqual({ appBaseUrl: "https://app", reviewInbox: null });
  });
});
