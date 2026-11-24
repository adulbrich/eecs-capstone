import { redactQueryError } from "#/lib/_internal/redact-query-error";
import type { NotificationConfig } from "#/lib/email/config";
import { buildNotificationConfig } from "#/lib/email/config";
import { accountSuspendedEmail, roleChangedEmail } from "#/lib/email/templates";
import type { SendEmailFn } from "./email-dispatch";
import { emailDispatch } from "./email-dispatch";

/**
 * The two account emails, both mandatory for their recipient and both sent
 * after the write that caused them. Never throw: a failed email must not undo
 * a ban, and the caller runs outside the transaction so it cannot.
 */
export async function notifyRoleChangedByEmail(
  input: { role: string; to: string },
  send?: SendEmailFn,
  config: NotificationConfig = buildNotificationConfig()
): Promise<void> {
  try {
    if (!config.appBaseUrl) {
      throw new Error(
        "BETTER_AUTH_URL is not set, so no role email could be addressed"
      );
    }
    const dispatch = emailDispatch(send);
    await dispatch(
      input.to,
      roleChangedEmail({ role: input.role, url: config.appBaseUrl })
    );
  } catch (error) {
    console.error("Role change email failed", redactQueryError(error));
  }
}

export async function notifyBannedByEmail(
  input: { expiresAt: Date | null; reason: string; to: string },
  send?: SendEmailFn
): Promise<void> {
  try {
    const dispatch = emailDispatch(send);
    await dispatch(
      input.to,
      accountSuspendedEmail({
        expiresAt: input.expiresAt,
        reason: input.reason,
      })
    );
  } catch (error) {
    console.error("Ban email failed", redactQueryError(error));
  }
}
