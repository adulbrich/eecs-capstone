import {
  buildNotificationConfig,
  type NotificationConfig,
} from "#/lib/email/config";
import { getEmailSender } from "#/lib/email/sender";
import { notificationEmail } from "#/lib/email/templates";
import {
  EMAILED_INVENTORY_TYPES,
  type InventoryNotice,
} from "#/lib/inventory-notifications";
import type { SendEmailFn } from "./project-emails";

/**
 * Sends the email an inventory notice owes, if it owes one. Never throws, for
 * the reason `notifyTransitionByEmail` gives: this runs after the transaction
 * that wrote the bell row, and a failed email must not undo a checkout.
 *
 * The decision of who and what is the notice's own (`notificationFor` and
 * `customLineNotification`); this module only asks two questions of it: is
 * the type one that goes by email, and is there an address. A walk-in holder
 * answers yes to the second with no account at all, which is the case the
 * bell cannot serve and this exists for.
 */
export async function notifyInventoryByEmail(
  notice: InventoryNotice | null,
  send?: SendEmailFn,
  config: NotificationConfig = buildNotificationConfig()
): Promise<void> {
  if (!notice) {
    return;
  }
  const address = notice.recipient.email;
  if (!(address && EMAILED_INVENTORY_TYPES.has(notice.type))) {
    return;
  }
  try {
    if (!config.appBaseUrl) {
      throw new Error(
        "BETTER_AUTH_URL is not set, so no inventory email could be addressed"
      );
    }
    const dispatch: SendEmailFn =
      send ?? ((to, email) => getEmailSender().send(to, email));
    await dispatch(
      address,
      notificationEmail({
        message: notice.message,
        title: notice.title,
        url: `${config.appBaseUrl}${notice.link}`,
      })
    );
  } catch (error) {
    console.error(`Inventory email failed (${notice.type})`, error);
  }
}

/** Sends each notice's email in turn. The batch approve path collects several. */
export async function notifyInventoryBatchByEmail(
  notices: (InventoryNotice | null)[],
  send?: SendEmailFn
): Promise<void> {
  for (const notice of notices) {
    await notifyInventoryByEmail(notice, send);
  }
}
