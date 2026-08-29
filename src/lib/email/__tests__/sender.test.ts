import { describe, expect, it } from "vitest";
import { ConsoleEmailSender } from "../console-sender";
import { getEmailSender } from "../sender";
import { createSesEmailSender, SesEmailSender } from "../ses-sender";

// None of this was reachable from a test before: getEmailSender and
// createSesEmailSender read process.env at the point of use, so asserting
// "SES needs a from address" meant mutating the real environment. See #105.
describe("getEmailSender", () => {
  it("sends to the console when no transport is configured", () => {
    expect(getEmailSender({} as NodeJS.ProcessEnv)).toBeInstanceOf(
      ConsoleEmailSender
    );
  });

  it("builds a SES sender when the transport asks for one", () => {
    expect(
      getEmailSender({
        EMAIL_TRANSPORT: "ses",
        EMAIL_FROM: "noreply@example.edu",
      } as NodeJS.ProcessEnv)
    ).toBeInstanceOf(SesEmailSender);
  });

  it("refuses an unrecognised transport rather than silently sending nowhere", () => {
    expect(() =>
      getEmailSender({ EMAIL_TRANSPORT: "smtp" } as NodeJS.ProcessEnv)
    ).toThrow("Unknown EMAIL_TRANSPORT: smtp");
  });
});

describe("createSesEmailSender", () => {
  it("names EMAIL_FROM when it is missing", () => {
    // infra/ecs.tf sets EMAIL_TRANSPORT and EMAIL_FROM in one revision
    // precisely because this throws, and it throws at module scope through
    // getEmailSender() in auth.ts, so the pair arriving apart fails the app's
    // boot rather than just its email.
    expect(() =>
      createSesEmailSender({
        from: null,
        region: "us-east-1",
        replyTo: null,
      })
    ).toThrow("EMAIL_FROM must be set when EMAIL_TRANSPORT=ses");
  });

  it("builds a sender when a from address is present", () => {
    expect(
      createSesEmailSender({
        from: "noreply@example.edu",
        region: "us-west-2",
        replyTo: null,
      })
    ).toBeInstanceOf(SesEmailSender);
  });
});
