/**
 * The sweep that sends the proposer edit notice (#839): claim every project
 * whose burst of due edit log rows is ready, send one staff inbox email per
 * project with no transaction open, then stamp the rows emailed.
 *
 * Started by a request, never by a timer: `src/server.ts` runs this at most
 * once a minute per task, after a response, and ADR-0071 records why that
 * keeps ADR-0005. The rules (who is owed an email, when a burst is ready,
 * what it says) are in `src/lib/staff-edit-email.ts`.
 *
 * Delivery is at least once. Two sweeps never claim one burst, because the
 * claim runs under a transaction-scoped advisory lock: `FOR UPDATE SKIP
 * LOCKED` alone locks rows, and a burst is a project's rows together, so two
 * tasks scanning at once could each take part of one burst and send two
 * partial emails. A send that throws leaves its rows claimed and unstamped,
 * and a later sweep takes them again once the claim is `CLAIM_RECLAIM_MS`
 * old. A task that dies between the send and the stamp costs a duplicate,
 * which ADR-0019 prefers to a lost email.
 */

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import { projectEditLog, projects, user } from "#/db/schema";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import {
  buildNotificationConfig,
  type NotificationConfig,
} from "#/lib/email/config";
import type { RenderedEmail } from "#/lib/email/templates";
import {
  isBurstReady,
  reclaimBefore,
  staffEditEmail,
} from "#/lib/staff-edit-email";
import { emailDispatch, type SendEmailFn } from "./email-dispatch";
import { warnNoStaffInbox } from "./project-emails";

/**
 * The two lines the `email_failures` metric filter in `infra/alarms.tf`
 * counts, spelled once: reworded, the alarm goes quiet (docs/QUIRKS.md).
 */
export const SWEEP_FAILED = "Staff edit email sweep failed";
function emailFailedFor(projectId: string): string {
  return `Staff edit email failed for project ${projectId}`;
}

/** `Map.groupBy`, which the ES2022 lib this project targets does not type. */
function groupByProject<T extends { projectId: string }>(
  rows: readonly T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.projectId);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.projectId, [row]);
    }
  }
  return groups;
}

/**
 * A due row no sweep has sent, and that no live sweep holds. The predicate
 * names the partial index's own two conditions as bare SQL, not as bound
 * parameters, so the planner can prove the index covers it (the PR for #839
 * shows the plan).
 */
function claimable(now: Date): SQL {
  return and(
    sql`${projectEditLog.staffEmailDue}`,
    isNull(projectEditLog.staffEmailedAt),
    or(
      isNull(projectEditLog.staffEmailClaimedAt),
      lt(projectEditLog.staffEmailClaimedAt, reclaimBefore(now))
    )
  ) as SQL;
}

/**
 * The rows this sweep claimed for one project. The claim's own timestamp is
 * the token, so loading and stamping bind three values however many saves
 * the burst holds, and neither touches a save made since the claim (not
 * claimed yet) or rows a later sweep reclaimed (a newer timestamp).
 */
function claimedBy(projectId: string, claimedAt: Date): SQL {
  return and(
    eq(projectEditLog.projectId, projectId),
    eq(projectEditLog.staffEmailClaimedAt, claimedAt),
    isNull(projectEditLog.staffEmailedAt)
  ) as SQL;
}

/**
 * Claims every ready burst in one short transaction and commits, so the send
 * that follows holds no lock and no pooled connection, and returns the
 * projects claimed. A second sweep that cannot take the lock returns nothing:
 * the first is claiming everything there is.
 */
async function claimReadyBursts(now: Date): Promise<string[]> {
  return await db.transaction(async (tx) => {
    const [lock] = (
      await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('staff_edit_email_claim')) AS locked`
      )
    ).rows;
    if (!lock?.locked) {
      return [];
    }
    const rows = await tx
      .select({
        createdAt: projectEditLog.createdAt,
        projectId: projectEditLog.projectId,
      })
      .from(projectEditLog)
      .where(claimable(now));
    const ready = [...groupByProject(rows)]
      .filter(([, burst]) =>
        isBurstReady(
          burst.map((r) => r.createdAt),
          now
        )
      )
      .map(([projectId]) => projectId);
    if (ready.length === 0) {
      return [];
    }
    // By project, not by row id: how many saves a burst holds is the
    // proposer's to choose, and past 65,535 bound ids Postgres refuses the
    // statement, which would fail every sweep for every project. The
    // predicate again, so a row the select read is still claimable.
    const claimed = await tx
      .update(projectEditLog)
      .set({ staffEmailClaimedAt: now })
      .where(and(inArray(projectEditLog.projectId, ready), claimable(now)))
      .returning({ projectId: projectEditLog.projectId });
    return [...new Set(claimed.map((r) => r.projectId))];
  });
}

/** Stamps the rows this sweep claimed, so a save since the claim stays unsent. */
async function stampEmailed(projectId: string, claimedAt: Date): Promise<void> {
  await db
    .update(projectEditLog)
    .set({ staffEmailedAt: claimedAt })
    .where(claimedBy(projectId, claimedAt));
}

/**
 * Sends one notice and reports whether it went. Never throws. Split from the
 * sweep so `email-failures.test.ts` can drive the failure line without a
 * database; that line is one of the alternatives the `email_failures` metric
 * filter in `infra/alarms.tf` counts.
 */
export async function deliverStaffEditEmail(
  projectId: string,
  email: RenderedEmail,
  staffInbox: string,
  send?: SendEmailFn
): Promise<boolean> {
  try {
    await emailDispatch(send)(staffInbox, email);
    return true;
  } catch (error) {
    console.error(emailFailedFor(projectId), redactQueryError(error));
    return false;
  }
}

/**
 * One claimed burst: stamped without a send when there is nothing to send or
 * nowhere to send it, stamped after a send that went, and left claimed after
 * one that did not.
 */
async function settleBurst(
  projectId: string,
  now: Date,
  config: NotificationConfig,
  send?: SendEmailFn
): Promise<void> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  // Hard delete cascades the rows away, so a missing project is a race with
  // one. A soft-deleted project is staff's own doing; restoring it later
  // does not send what was stamped here, and the edit log still has it.
  if (!project || project.deletedAt) {
    await stampEmailed(projectId, now);
    return;
  }
  // Once per burst, not once a minute: the stamp is what stops the warning
  // repeating, and the edit log still has every save.
  if (!config.staffInbox) {
    warnNoStaffInbox("proposer edit notice", project.id);
    await stampEmailed(projectId, now);
    return;
  }
  // Retried rather than stamped: the link is the email's whole point, and
  // under `ses` the app does not boot without it, so this is a misconfigured
  // dev or staging box, which the failure line names every ten minutes.
  if (!config.appBaseUrl) {
    console.error(
      emailFailedFor(project.id),
      "BETTER_AUTH_URL is not set, so no proposer edit notice could be addressed"
    );
    return;
  }
  const saves = await db
    .select({
      changedFields: projectEditLog.changedFields,
      createdAt: projectEditLog.createdAt,
      editorEmail: user.email,
      editorName: user.name,
      newValues: projectEditLog.newValues,
      oldValues: projectEditLog.oldValues,
    })
    .from(projectEditLog)
    .innerJoin(user, eq(projectEditLog.editorId, user.id))
    .where(claimedBy(projectId, now))
    .orderBy(asc(projectEditLog.createdAt));
  // The people who made the edits, not whoever the project names now: staff
  // may have reassigned it, mid-burst included.
  const editors = [
    ...new Map(
      saves.map((s) => [
        s.editorEmail,
        { email: s.editorEmail, name: s.editorName },
      ])
    ).values(),
  ];
  const email =
    saves.length > 0
      ? staffEditEmail({
          editLogUrl: `${config.appBaseUrl}/projects/${project.id}#edit-log`,
          editors,
          live: project,
          saves: saves.map((s) => ({
            changedFields: s.changedFields,
            createdAt: s.createdAt,
            newValues: s.newValues as Record<string, unknown>,
            oldValues: s.oldValues as Record<string, unknown>,
          })),
          title: project.title,
        })
      : null;
  // Save then undo: no net change, no email. The edit log keeps both rows.
  if (!email) {
    await stampEmailed(projectId, now);
    return;
  }
  if (await deliverStaffEditEmail(project.id, email, config.staffInbox, send)) {
    await stampEmailed(projectId, now);
  }
}

export interface StaffEditSweepOptions {
  config?: NotificationConfig;
  /** The sweep's clock. Tests move it past the quiet period instead of waiting. */
  now?: Date;
  send?: SendEmailFn;
}

/**
 * One sweep. Never throws, and returns how many bursts it claimed, for the
 * tests. A claim that fails is logged and the next sweep tries again; a burst
 * that throws on its way (a database error loading it) is logged and left
 * claimed for a later sweep, and the others still go. Both lines are counted
 * by the `email_failures` metric filter in `infra/alarms.tf`.
 */
export async function runStaffEditEmailSweep(
  opts: StaffEditSweepOptions = {}
): Promise<{ claimed: number }> {
  const now = opts.now ?? new Date();
  const config = opts.config ?? buildNotificationConfig();
  let claimed: string[];
  try {
    claimed = await claimReadyBursts(now);
  } catch (error) {
    console.error(SWEEP_FAILED, redactQueryError(error));
    return { claimed: 0 };
  }
  for (const projectId of claimed) {
    try {
      await settleBurst(projectId, now, config, opts.send);
    } catch (error) {
      console.error(emailFailedFor(projectId), redactQueryError(error));
    }
  }
  return { claimed: claimed.length };
}
