import { beforeEach, describe, expect, it, vi } from "vitest";

const construct = vi.fn();

// Mocked so the caching claims in ses-sender.ts are asserted rather than only
// asserted in a comment. Nothing here reaches AWS either way, since the client
// is only touched inside a send.
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    constructor(config: { region: string }) {
      construct(config.region);
    }
    send() {
      return Promise.resolve({});
    }
  },
  SendEmailCommand: class {},
}));

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
  // The region cache lives for the module's lifetime and there is no reset
  // hook, deliberately: exporting one would be test-only API on a production
  // module. Each case below uses regions no other case touches instead.
  beforeEach(() => {
    construct.mockClear();
  });

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

  it("builds no client until something is actually sent", () => {
    createSesEmailSender({
      from: "noreply@example.edu",
      region: "eu-west-1",
      replyTo: null,
    });
    expect(construct).not.toHaveBeenCalled();
  });

  it("shares one client per region across senders, and gives a second region its own", async () => {
    // project-emails.ts builds a fresh sender inside its dispatch lambda for
    // every email, so a per-sender client would be a per-email HTTP handler
    // that nothing closes. An unkeyed cache would hand ap-south-1 the
    // us-east-1 client, which is the bug this replaced.
    const make = (region: string) =>
      createSesEmailSender({
        from: "noreply@example.edu",
        region,
        replyTo: null,
      });
    const email = { html: "<p>x</p>", subject: "s", text: "x" };

    await make("ap-south-1").send("a@example.edu", email);
    await make("ap-south-1").send("b@example.edu", email);
    await make("ca-central-1").send("c@example.edu", email);

    expect(construct.mock.calls.map(([region]) => region)).toEqual([
      "ap-south-1",
      "ca-central-1",
    ]);
  });
});
