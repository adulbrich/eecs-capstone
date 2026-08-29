import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-sesv2";
import { buildEmailSenderConfig, type EmailSenderConfig } from "./config";
import type { EmailSender } from "./sender";
import type { RenderedEmail } from "./templates";

/**
 * Sends a `SendEmailCommand` to SES. Injected into `SesEmailSender` so the
 * sender can be unit-tested without touching AWS (mirrors `ResponsesFn` in
 * the Bedrock client).
 */
export type SesSendFn = (
  input: SendEmailCommandInput
) => Promise<SendEmailCommandOutput>;

export class SesEmailSender implements EmailSender {
  private readonly from: string;
  private readonly replyTo: string | null;
  private readonly sendCommand: SesSendFn;

  /**
   * `replyTo` is optional because `from` is the address DMARC aligns against;
   * a reply-to only decides where a human's reply lands, so mail sends
   * correctly without one.
   */
  constructor(
    from: string,
    sendCommand: SesSendFn,
    replyTo: string | null = null
  ) {
    this.from = from;
    this.sendCommand = sendCommand;
    this.replyTo = replyTo;
  }

  async send(to: string, email: RenderedEmail): Promise<void> {
    await this.sendCommand({
      FromEmailAddress: this.from,
      // `undefined` is dropped by the SDK serializer, so an unconfigured
      // reply-to leaves the header off rather than sending an empty list.
      ReplyToAddresses: this.replyTo ? [this.replyTo] : undefined,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject },
          Body: {
            Text: { Data: email.text },
            Html: { Data: email.html },
          },
        },
      },
    });
  }
}

let _client: SESv2Client | null = null;

function getSesClient(region: string): SESv2Client {
  if (!_client) {
    // Credentials come from the ECS task role via the default provider chain.
    _client = new SESv2Client({ region });
  }
  return _client;
}

/**
 * The throw lives here rather than in `buildEmailSenderConfig` because the
 * builder is reached at module scope through `getEmailSender()` in
 * `src/lib/auth.ts`, so a throw in the builder would fail the app's boot on
 * every transport instead of just the one that needs the variable. Here it
 * fires only when someone has actually asked for SES.
 */
export function createSesEmailSender(
  config: EmailSenderConfig = buildEmailSenderConfig()
): SesEmailSender {
  if (!config.from) {
    throw new Error("EMAIL_FROM must be set when EMAIL_TRANSPORT=ses");
  }
  // Deliberately not required: the ECS task definition always passes
  // EMAIL_REPLY_TO, as an empty string until an address is decided, and email
  // must not stop working for want of one.
  return new SesEmailSender(
    config.from,
    (input) => getSesClient(config.region).send(new SendEmailCommand(input)),
    config.replyTo
  );
}
