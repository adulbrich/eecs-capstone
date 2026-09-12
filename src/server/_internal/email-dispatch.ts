import { getEmailSender } from "#/lib/email/sender";
import type { RenderedEmail } from "#/lib/email/templates";

export type SendEmailFn = (to: string, email: RenderedEmail) => Promise<void>;

/** The one optional argument every emailing `*As` function takes. */
export interface EmailOptions {
  /** Test seam. Production callers omit it and the notifier resolves its own transport. */
  send?: SendEmailFn;
}

/**
 * The injected sender when a test supplies one, else the configured transport.
 *
 * Resolved per call rather than at module scope on purpose: `getEmailSender`
 * reads the environment, and the integration suites set it per test.
 */
export function emailDispatch(send?: SendEmailFn): SendEmailFn {
  return send ?? ((to, email) => getEmailSender().send(to, email));
}
