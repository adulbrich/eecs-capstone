import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import {
  buildNotificationConfig,
  type NotificationConfig,
} from "#/lib/email/config";
import { getEmailSender } from "#/lib/email/sender";
import {
  projectApprovedEmail,
  projectChangesRequestedEmail,
  projectSubmittedEmail,
  type RenderedEmail,
} from "#/lib/email/templates";
import type { ProjectStatus } from "#/lib/vocabularies";

export type SendEmailFn = (to: string, email: RenderedEmail) => Promise<void>;

export interface TransitionEmailProject {
  description: string | null;
  id: string;
  proposerEmail: string | null;
  proposerId: string | null;
  title: string;
}

async function lookupProposer(
  proposerId: string | null
): Promise<{ email: string | null; name: string | null }> {
  if (!proposerId) {
    return { email: null, name: null };
  }
  const [row] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, proposerId));
  return { email: row?.email ?? null, name: row?.name ?? null };
}

/**
 * The address to reach the proposer on.
 *
 * proposerId is canonical: when the project is linked to an account, that
 * account's current email wins over the stored `proposer_email`, which may be
 * stale. Falls back to the stored address only when no account is linked, which
 * is how a proposer without an account is still reachable.
 *
 * This precedence deliberately matches `getProposerForEditAs` in
 * `projects-queries.ts`. That function is what the staff dialog displays, so
 * diverging here would name one address in the UI and mail another.
 */
export function resolveProposerAddress(
  storedEmail: string | null,
  accountEmail: string | null
): string | null {
  return accountEmail ?? storedEmail;
}

async function sendSubmitted(
  project: TransitionEmailProject,
  url: string,
  send: SendEmailFn,
  inbox: string | null
): Promise<void> {
  if (!inbox) {
    // Say so rather than returning silently. An unset review inbox means staff
    // are never told a project was submitted, and nothing else in the app
    // surfaces that: the transition succeeds and the queue fills up unwatched.
    console.warn(
      `EMAIL_REVIEW_INBOX is unset, so no submission notice was sent for project ${project.id}`
    );
    return;
  }
  const account = await lookupProposer(project.proposerId);
  await send(
    inbox,
    projectSubmittedEmail({
      description: project.description,
      proposerEmail: resolveProposerAddress(
        project.proposerEmail,
        account.email
      ),
      proposerName: account.name,
      title: project.title,
      url,
    })
  );
}

async function sendToProposer(
  project: TransitionEmailProject,
  target: "approved" | "changes_requested",
  comment: string | null,
  url: string,
  send: SendEmailFn
): Promise<void> {
  const account = await lookupProposer(project.proposerId);
  const to = resolveProposerAddress(project.proposerEmail, account.email);
  if (!to) {
    return;
  }
  const email =
    target === "approved"
      ? projectApprovedEmail({ comment, title: project.title, url })
      : projectChangesRequestedEmail({
          comment: comment ?? "",
          title: project.title,
          url,
        });
  await send(to, email);
}

/**
 * Sends the review emails for a transition that has already been committed.
 *
 * Never throws. A failed email must not undo an approval, and the caller runs
 * outside the transaction precisely so it cannot. Mirrors the swallow-and-log
 * shape of `refreshProjectEmbedding`.
 */
export async function notifyTransitionByEmail(
  project: TransitionEmailProject,
  target: ProjectStatus,
  comment: string | null,
  sendEmail: boolean,
  send?: SendEmailFn,
  config: NotificationConfig = buildNotificationConfig()
): Promise<void> {
  if (!sendEmail) {
    return;
  }
  try {
    // Absolute, because these links are followed from a mail client, and
    // required rather than skipped: without it every transition email was
    // silently dropped, and the silence is what made this worth changing.
    //
    // Checked here rather than thrown from `buildNotificationConfig` because a
    // default parameter is evaluated before the body runs, so a throw in the
    // builder would escape this function's own catch and reach `projects.ts`,
    // which calls this after the transition is already committed and relies on
    // it never throwing. Inside the try, an unset value costs a named log line
    // instead of an undone approval.
    if (!config.appBaseUrl) {
      throw new Error(
        "BETTER_AUTH_URL is not set, so no transition email could be addressed"
      );
    }
    const dispatch: SendEmailFn =
      send ?? ((to, email) => getEmailSender().send(to, email));
    const url = `${config.appBaseUrl}/projects/${project.id}`;

    if (target === "submitted") {
      await sendSubmitted(project, url, dispatch, config.reviewInbox);
      return;
    }
    if (target === "approved" || target === "changes_requested") {
      await sendToProposer(project, target, comment, url, dispatch);
    }
  } catch (error) {
    console.error(`Review email failed for project ${project.id}`, error);
  }
}
