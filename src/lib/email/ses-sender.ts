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
 * The SDK's default handler sets no request timeout, so without this a stalled
 * SES call holds whatever awaits it for as long as the socket stays open: the
 * sign-in code form, or a save that has already committed and is waiting on
 * its notice, the shape #618 fixed for Bedrock and #621 for S3 (#708). The
 * signal is shared by every attempt, and the SDK races its retry backoff
 * against it and never retries the abort, so a stall costs the bound once.
 * A timed-out send rejects like any other SES error, and every caller already
 * catches and logs that; the line reads "AbortError: Request aborted", with
 * nothing saying it was this bound.
 *
 * Too tight is the worse mistake here. The sign-in send answers success
 * whether or not the mail went, so a send cut off that would have landed is a
 * code that never arrives, with nothing on the page to say so. Time spent
 * resolving the task role's credentials counts against the bound, though the
 * bound does not cut a stalled credential fetch short; the provider's own
 * timeouts do.
 *
 * Sized from the production ALB logs, September to 17 November 2026, since
 * SES publishes no latency metric: the eight requests that each sent one
 * email (a sign-in code, three cart submissions, three line approvals, a
 * project submission) took 0.15 s to 0.34 s end to end, database work
 * included. 5 s is fifteen times the slowest, the same bound as an S3 delete,
 * which is the same shape of call.
 *
 * The bound is per send, not per request. `approveRequestLinesAs` emails once
 * per line in sequence, so approving twelve or more lines during an SES stall
 * meets the ALB's 60 s idle timeout and answers 504 after the approvals
 * committed.
 */
export const SES_SEND_TIMEOUT_MS = 5000;

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
  // A fresh signal per send: `auth.ts` builds this sender once at module
  // scope, so a signal made out here would time out once and then abort every
  // later send before it started.
  const sendCommand: SesSendFn = (input) =>
    getSesClient(config.region).send(new SendEmailCommand(input), {
      abortSignal: AbortSignal.timeout(SES_SEND_TIMEOUT_MS),
    });
  // Deliberately not required: the ECS task definition always passes
  // EMAIL_REPLY_TO, as an empty string until an address is decided, and email
  // must not stop working for want of one.
  return new SesEmailSender(config.from, sendCommand, config.replyTo);
}
