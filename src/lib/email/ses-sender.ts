import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-sesv2";
import type { SesSenderConfig } from "./config";
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

/**
 * One client per region, for the life of the process.
 *
 * Keyed rather than a single slot because the key is the whole point: an
 * unkeyed cache returns the first client built to every later caller, so a
 * sender configured for a second region silently sends through the first. It
 * is also not per-sender, because `project-emails.ts` builds a fresh sender
 * inside its dispatch lambda for every email, and a per-sender client would
 * mean a new HTTP handler per message that nothing ever closes.
 */
const clientsByRegion = new Map<string, SESv2Client>();

function getSesClient(region: string): SESv2Client {
  const existing = clientsByRegion.get(region);
  if (existing) {
    return existing;
  }
  // Credentials come from the ECS task role via the default provider chain,
  // resolved at signing time rather than here.
  const client = new SESv2Client({ region });
  clientsByRegion.set(region, client);
  return client;
}

/**
 * The throw lives here rather than in `buildEmailSenderConfig` because the
 * builder is reached at module scope through `getEmailSender()` in
 * `src/lib/auth.ts`, so a throw in the builder would fail the app's boot on
 * every transport instead of just the one that needs the variable. Here it
 * fires only when someone has actually asked for SES.
 */
export function createSesEmailSender(config: SesSenderConfig): SesEmailSender {
  if (!config.from) {
    throw new Error("EMAIL_FROM must be set when EMAIL_TRANSPORT=ses");
  }
  const sendCommand: SesSendFn = (input) =>
    getSesClient(config.region).send(new SendEmailCommand(input));
  // Deliberately not required: the ECS task definition always passes
  // EMAIL_REPLY_TO, as an empty string until an address is decided, and email
  // must not stop working for want of one.
  return new SesEmailSender(config.from, sendCommand, config.replyTo);
}
