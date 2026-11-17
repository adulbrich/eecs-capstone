import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSesEmailSender, SES_SEND_TIMEOUT_MS } from "../ses-sender";

/**
 * The SDK's default handler has no request timeout, so without a signal a
 * stalled SES call holds whatever awaits it, a sign-in code or a committed
 * save's notice, for as long as the socket stays open (#708).
 */
const EMAIL = {
  html: "<p>Hi</p>",
  subject: "Your sign-in code",
  text: "Your code is 123456",
};

/** `send` is overloaded, so the spy's recorded arguments need naming. */
type SendCall = [unknown, { abortSignal: AbortSignal }];

const CONFIG = {
  from: "noreply@example.edu",
  region: "us-west-2",
  replyTo: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSesEmailSender bounds the send", () => {
  it("passes the send an AbortSignal.timeout of SES_SEND_TIMEOUT_MS", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const send = vi
      .spyOn(SESv2Client.prototype, "send")
      .mockResolvedValue({} as never);

    await createSesEmailSender(CONFIG).send("a@b.com", EMAIL);

    expect(timeout).toHaveBeenCalledWith(SES_SEND_TIMEOUT_MS);
    const [command, options] = send.mock.calls[0] as unknown as SendCall;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(options.abortSignal).toBe(timeout.mock.results[0]?.value);
  });

  it("gives every send its own signal", async () => {
    // The sender in `auth.ts` lives for the whole process, so one shared
    // signal would expire once and abort every send after it.
    const send = vi
      .spyOn(SESv2Client.prototype, "send")
      .mockResolvedValue({} as never);
    const sender = createSesEmailSender(CONFIG);

    await sender.send("a@b.com", EMAIL);
    await sender.send("c@d.com", EMAIL);

    const signals = send.mock.calls.map(
      (call) => (call as unknown as SendCall)[1].abortSignal
    );
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
