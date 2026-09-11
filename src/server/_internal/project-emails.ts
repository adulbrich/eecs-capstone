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
  projectCommentEmail,
  projectDeletedEmail,
  projectReturnedToDraftEmail,
  projectSubmittedEmail,
  proposerCommentEmail,
  type RenderedEmail,
} from "#/lib/email/templates";
import type { ProjectStatus } from "#/lib/vocabularies";

export type SendEmailFn = (to: string, email: RenderedEmail) => Promise<void>;

/** The parts of a project every proposer-facing email reads. */
export interface EmailProject {
  id: string;
  proposerEmail: string | null;
  proposerId: string | null;
  title: string;
}

export interface TransitionEmailProject extends EmailProject {
  description: string | null;
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

/**
 * Says so rather than returning silently: an unset staff inbox under the
 * console transport means staff are never told, and nothing else in the app
 * surfaces that. Under `ses` the app refuses to boot without one.
 */
function warnNoStaffInbox(what: string, projectId: string): void {
  console.warn(
    `EMAIL_STAFF_INBOX is unset, so no ${what} was sent for project ${projectId}`
  );
}

async function sendSubmitted(
  project: TransitionEmailProject,
  url: string,
  send: SendEmailFn,
  inbox: string | null
): Promise<void> {
  if (!inbox) {
    warnNoStaffInbox("submission notice", project.id);
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

function proposerEmailFor(
  target: "approved" | "changes_requested" | "draft",
  comment: string | null,
  title: string,
  url: string
): RenderedEmail {
  switch (target) {
    case "approved":
      return projectApprovedEmail({ comment, title, url });
    case "changes_requested":
      return projectChangesRequestedEmail({
        comment: comment ?? "",
        title,
        url,
      });
    case "draft":
      return projectReturnedToDraftEmail({ comment, title, url });
    default: {
      const unhandled: never = target;
      throw new Error(`No proposer email for ${String(unhandled)}`);
    }
  }
}

async function sendToProposer(
  project: TransitionEmailProject,
  target: "approved" | "changes_requested" | "draft",
  comment: string | null,
  url: string,
  send: SendEmailFn
): Promise<void> {
  const account = await lookupProposer(project.proposerId);
  const to = resolveProposerAddress(project.proposerEmail, account.email);
  if (!to) {
    return;
  }
  await send(to, proposerEmailFor(target, comment, project.title, url));
}

export interface TransitionEmailInput {
  /** Who moved the project. A proposer moving their own project is told nothing. */
  actorId: string;
  comment: string | null;
  project: TransitionEmailProject;
  /** The staff per-action skip. Already forced true for non-staff callers. */
  sendEmail: boolean;
  target: ProjectStatus;
}

/**
 * Sends the review emails for a transition that has already been committed.
 *
 * Never throws. A failed email must not undo an approval, and the caller runs
 * outside the transaction precisely so it cannot. Mirrors the swallow-and-log
 * shape of `refreshProjectEmbedding`.
 */
export async function notifyTransitionByEmail(
  input: TransitionEmailInput,
  send?: SendEmailFn,
  config: NotificationConfig = buildNotificationConfig()
): Promise<void> {
  const { actorId, comment, project, sendEmail, target } = input;
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
      await sendSubmitted(project, url, dispatch, config.staffInbox);
      return;
    }
    if (target === "approved" || target === "changes_requested") {
      await sendToProposer(project, target, comment, url, dispatch);
      return;
    }
    // Returned to draft. The owner reaches the same target by withdrawing
    // their own submission, and the only person to tell is then the one who
    // clicked: the same silence rule `proposerToTell` applies to the in-app
    // row. Approve and changes-requested skip the check because an owner
    // cannot reach either.
    if (target === "draft" && project.proposerId !== actorId) {
      await sendToProposer(project, "draft", comment, url, dispatch);
    }
  } catch (error) {
    console.error(`Review email failed for project ${project.id}`, error);
  }
}

export interface CommentEmailInput {
  /** Staff comments reach the proposer; the proposer's own reach staff. */
  authorIsStaff: boolean;
  comment: { content: string; id: string; isInternal: boolean | null };
  project: EmailProject;
}

/**
 * Sends the email a committed comment owes. Never throws, for the reason
 * `notifyTransitionByEmail` gives.
 *
 * Only staff and the proposer may comment (`addCommentAs`), so "not staff" is
 * the proposer, and the two directions are the whole rule: staff to proposer,
 * proposer to the staff inbox. An internal comment is staff talking among
 * themselves and reaches no inbox, the same as it reaches no bell.
 */
export async function notifyCommentByEmail(
  input: CommentEmailInput,
  send?: SendEmailFn,
  config: NotificationConfig = buildNotificationConfig()
): Promise<void> {
  const { authorIsStaff, comment, project } = input;
  if (comment.isInternal) {
    return;
  }
  try {
    if (!config.appBaseUrl) {
      throw new Error(
        "BETTER_AUTH_URL is not set, so no comment email could be addressed"
      );
    }
    const dispatch: SendEmailFn =
      send ?? ((to, email) => getEmailSender().send(to, email));
    const url = `${config.appBaseUrl}/projects/${project.id}#comment-${comment.id}`;
    const account = await lookupProposer(project.proposerId);
    const proposerAddress = resolveProposerAddress(
      project.proposerEmail,
      account.email
    );

    if (authorIsStaff) {
      if (!proposerAddress) {
        return;
      }
      await dispatch(
        proposerAddress,
        projectCommentEmail({
          content: comment.content,
          title: project.title,
          url,
        })
      );
      return;
    }
    if (!config.staffInbox) {
      warnNoStaffInbox("proposer comment notice", project.id);
      return;
    }
    await dispatch(
      config.staffInbox,
      proposerCommentEmail({
        content: comment.content,
        proposerEmail: proposerAddress,
        proposerName: account.name,
        title: project.title,
        url,
      })
    );
  } catch (error) {
    console.error(`Comment email failed for project ${project.id}`, error);
  }
}

export interface HardDeleteEmailInput {
  actorId: string;
  project: EmailProject;
}

/**
 * Sends the one email a hard delete owes. Never throws.
 *
 * Hard delete is drafts only, by the owner or by staff. The owner deleting
 * their own draft is told nothing (the silence rule); staff deleting somebody
 * else's is the case that needs an email, because the row is gone and no
 * in-app link can point at it any more. No base URL is needed for the same
 * reason.
 */
export async function notifyHardDeleteByEmail(
  input: HardDeleteEmailInput,
  send?: SendEmailFn
): Promise<void> {
  const { actorId, project } = input;
  if (project.proposerId === actorId) {
    return;
  }
  try {
    const dispatch: SendEmailFn =
      send ?? ((to, email) => getEmailSender().send(to, email));
    const account = await lookupProposer(project.proposerId);
    const address = resolveProposerAddress(
      project.proposerEmail,
      account.email
    );
    if (!address) {
      return;
    }
    await dispatch(address, projectDeletedEmail({ title: project.title }));
  } catch (error) {
    console.error(`Delete email failed for project ${project.id}`, error);
  }
}
