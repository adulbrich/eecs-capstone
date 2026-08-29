/**
 * The environment the email path is configured from, resolved once and typed.
 *
 * This module imports nothing, for the reason `ai-review-limits.ts` gives:
 * `project-emails.ts` statically imports `#/db`, whose body throws when
 * DATABASE_URL is unset, so a unit test reaching config through that module
 * would only pass on a machine with a `.env`. A dependency-free module is a
 * test that passes in CI.
 *
 * `buildEmailSenderConfig` is pure and total. It does not throw on a missing
 * `EMAIL_FROM` even though SES requires one, because `getEmailSender()` runs at
 * module scope in `src/lib/auth.ts`: a throw in here would fail the app's boot
 * rather than its email, which `infra/ecs.tf` already documents as the reason
 * EMAIL_TRANSPORT and EMAIL_FROM must arrive in one terraform revision. The
 * throw stays at the call site in `createSesEmailSender`, where it was.
 */

const DEFAULT_REGION = "us-east-1";

export interface EmailSenderConfig {
  /** Verified SES sender identity. Required under the `ses` transport only. */
  from: string | null;
  region: string;
  /** Where replies land. Optional: `from` is what DMARC aligns against. */
  replyTo: string | null;
  transport: string;
}

/**
 * What `createSesEmailSender` actually reads. Split off so the SES factory
 * cannot be handed a `transport` it ignores, and so a test constructing one
 * does not have to invent a field nothing looks at.
 */
export type SesSenderConfig = Omit<EmailSenderConfig, "transport">;

export function buildEmailSenderConfig(
  env: NodeJS.ProcessEnv = process.env
): EmailSenderConfig {
  return {
    from: blankToNull(env.EMAIL_FROM),
    // AWS_REGION is the SDK's own variable and is set on ECS whether or not
    // anyone configures SES, so it is the fallback rather than a second thing
    // to remember. Blank falls through the same as unset, because an empty
    // region reaches the SDK as an invalid client rather than a default.
    region:
      blankToNull(env.SES_REGION) ??
      blankToNull(env.AWS_REGION) ??
      DEFAULT_REGION,
    replyTo: blankToNull(env.EMAIL_REPLY_TO),
    // Bare `??` on purpose, unlike everything above. A blank transport is a
    // misconfiguration, and falling through to "console" would answer it by
    // silently sending nowhere. It reaches the unknown-transport throw in
    // `getEmailSender` instead, which names the variable.
    transport: env.EMAIL_TRANSPORT ?? "console",
  };
}

export interface NotificationConfig {
  /**
   * Absolute base URL for links followed from a mail client.
   *
   * Named for Better Auth because that is the variable operators already set,
   * but Better Auth reads it from its own internals. The only read in this
   * codebase is this one, to build project links.
   */
  appBaseUrl: string | null;
  /** Who receives the "new project submitted" notice. */
  reviewInbox: string | null;
}

export function buildNotificationConfig(
  env: NodeJS.ProcessEnv = process.env
): NotificationConfig {
  return {
    appBaseUrl: blankToNull(env.BETTER_AUTH_URL),
    reviewInbox: blankToNull(env.EMAIL_REVIEW_INBOX),
  };
}

/**
 * The ECS task definition passes an empty string for every variable terraform
 * has no value for, so blank is the shape a missing value actually arrives in.
 *
 * Applied to the addresses and the region, not to `transport`; see the comment
 * on that field for why it is the exception.
 */
function blankToNull(value: string | undefined): string | null {
  return value?.trim() || null;
}
