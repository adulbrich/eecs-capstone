import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-sesv2";
import type { EmailMessage, EmailSender } from "./sender";

const DEFAULT_REGION = "us-east-1";

/**
 * Sends a `SendEmailCommand` to SES. Injected into `SesEmailSender` so the
 * sender can be unit-tested without touching AWS (mirrors `ConverseFn` in
 * the Bedrock client).
 */
export type SesSendFn = (
  input: SendEmailCommandInput
) => Promise<SendEmailCommandOutput>;

interface EmailContent {
  cta: string;
  intro: string;
  subject: string;
}

const VERIFICATION: EmailContent = {
  subject: "Verify your email",
  intro: "Confirm your email address to finish setting up your account.",
  cta: "Verify email",
};

const PASSWORD_RESET: EmailContent = {
  subject: "Reset your password",
  intro: "We received a request to reset your password.",
  cta: "Reset password",
};

export class SesEmailSender implements EmailSender {
  private readonly from: string;
  private readonly replyTo: string | null;
  private readonly send: SesSendFn;

  /**
   * `replyTo` is optional because `from` is the address DMARC aligns against;
   * a reply-to only decides where a human's reply lands, so mail sends
   * correctly without one.
   */
  constructor(from: string, send: SesSendFn, replyTo: string | null = null) {
    this.from = from;
    this.send = send;
    this.replyTo = replyTo;
  }

  sendVerification(msg: EmailMessage): Promise<void> {
    return this.dispatch(VERIFICATION, msg);
  }

  sendPasswordReset(msg: EmailMessage): Promise<void> {
    return this.dispatch(PASSWORD_RESET, msg);
  }

  private async dispatch(
    content: EmailContent,
    msg: EmailMessage
  ): Promise<void> {
    await this.send({
      FromEmailAddress: this.from,
      // `undefined` is dropped by the SDK serializer, so an unconfigured
      // reply-to leaves the header off rather than sending an empty list.
      ReplyToAddresses: this.replyTo ? [this.replyTo] : undefined,
      Destination: { ToAddresses: [msg.to] },
      Content: {
        Simple: {
          Subject: { Data: content.subject },
          Body: {
            Text: { Data: `${content.intro}\n\n${content.cta}: ${msg.url}\n` },
            Html: {
              Data: `<p>${content.intro}</p><p><a href="${msg.url}">${content.cta}</a></p>`,
            },
          },
        },
      },
    });
  }
}

let _client: SESv2Client | null = null;

function getSesClient(): SESv2Client {
  if (!_client) {
    // Credentials come from the ECS task role via the default provider chain.
    _client = new SESv2Client({
      region:
        process.env.SES_REGION ?? process.env.AWS_REGION ?? DEFAULT_REGION,
    });
  }
  return _client;
}

export function createSesEmailSender(): SesEmailSender {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM must be set when EMAIL_TRANSPORT=ses");
  }
  // Deliberately not required: the ECS task definition always passes
  // EMAIL_REPLY_TO, as an empty string until an address is decided, and email
  // must not stop working for want of one.
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || null;
  return new SesEmailSender(
    from,
    (input) => getSesClient().send(new SendEmailCommand(input)),
    replyTo
  );
}
