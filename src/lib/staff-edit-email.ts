/**
 * The proposer edit notice (#839): which saves owe the staff inbox an email,
 * when a project's burst of them is ready to send, what changed across the
 * burst, and what the email may say about it.
 *
 * A proposer's edit to an approved or published project goes live at once,
 * and staff are told afterwards, once per burst: one email after the proposer
 * has stopped saving for `STAFF_EDIT_QUIET_MS`, or `STAFF_EDIT_CAP_MS` after
 * the first save, whichever is first. ADR-0071 records why a request starts
 * the sweep that sends it.
 *
 * Pure and dependency-free, like `project-notifications.ts`, so every rule
 * here is a unit test. The claim, the send and the stamp are in
 * `src/server/_internal/staff-edit-emails.ts`.
 */

import { formatOfficeDay } from "./day-range";
import {
  oneLine,
  type ProposerEditChange,
  proposerEditsEmail,
  type RenderedEmail,
} from "./email/templates";
import { formatOfficeTime } from "./pickup-window";
import { formatEditValue, projectEditFieldLabel } from "./project-edit-fields";
import type { ProjectStatus } from "./vocabularies";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How long a proposer must stop saving before their burst is sent, and the
 * longest a burst waits after its first save however they keep saving. Both
 * are guesses until the production gate query reports the gaps between one
 * proposer's saves (#839), so each stays a one-line change here. README,
 * PRD section 13, ADR-0071 and the admin page's sentence state the numbers
 * in words; change those in the same commit.
 */
export const STAFF_EDIT_QUIET_MS = 30 * MINUTE_MS;
export const STAFF_EDIT_CAP_MS = 3 * HOUR_MS;

/** How often one task may start a sweep. The waker compares this and nothing else. */
export const SWEEP_EVERY_MS = MINUTE_MS;

/**
 * How old a claim with no emailed stamp must be before another sweep may take
 * it. Long past the SES send's own bound (#708), so a claim this old is a
 * task that died or a send that threw, unless one sweep had about sixty
 * bursts to settle one after another, which is the rare duplicate ADR-0071
 * accepts.
 */
export const CLAIM_RECLAIM_MS = 10 * MINUTE_MS;

const OWED_STATUSES: readonly ProjectStatus[] = ["approved", "published"];

/**
 * Whether a save owes the staff inbox an email: a proposer's edit to a
 * project staff have already approved. Staff are never owed one, a staff
 * member who proposed the project included; they are staff, and the edit log
 * is theirs to read.
 */
export function isOwedStaffEditEmail(
  status: ProjectStatus,
  editorIsStaff: boolean
): boolean {
  return !editorIsStaff && OWED_STATUSES.includes(status);
}

/**
 * Whether a project's unsent saves are ready to go as one email: the last is
 * a quiet period old, or the first is a cap old. `savedAt` is every save in
 * the burst; none means nothing to send.
 */
export function isBurstReady(savedAt: readonly Date[], now: Date): boolean {
  if (savedAt.length === 0) {
    return false;
  }
  const times = savedAt.map((d) => d.getTime());
  const sinceLast = now.getTime() - Math.max(...times);
  const sinceFirst = now.getTime() - Math.min(...times);
  return sinceLast >= STAFF_EDIT_QUIET_MS || sinceFirst >= STAFF_EDIT_CAP_MS;
}

/** The instant before which a claim with no emailed stamp may be taken again. */
export function reclaimBefore(now: Date): Date {
  return new Date(now.getTime() - CLAIM_RECLAIM_MS);
}

/** One save in a burst: one `project_edit_log` row. */
export interface BurstSave {
  changedFields: readonly string[];
  createdAt: Date;
  newValues: Readonly<Record<string, unknown>>;
  oldValues: Readonly<Record<string, unknown>>;
}

/** One field's change across a whole burst. */
export interface NetChange {
  after: unknown;
  before: unknown;
  field: string;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What changed from before the first save to after the last, per field, in
 * the order the fields were first changed. A field changed and changed back
 * drops out, so a save followed by its undo is no change at all.
 *
 * Unless someone else changed the field in between: a save whose old value is
 * not the previous save's new value starts the field over from that old
 * value. Otherwise a proposer who changes A to B, sees staff correct it to C,
 * and sets it back to A would net to no change, and staff would never hear
 * that their correction was undone.
 */
export function netChange(saves: readonly BurstSave[]): NetChange[] {
  const ordered = [...saves].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const byField = new Map<string, NetChange>();
  for (const save of ordered) {
    for (const field of save.changedFields) {
      const before = save.oldValues[field] ?? null;
      const after = save.newValues[field] ?? null;
      const seen = byField.get(field);
      if (seen && sameValue(seen.after, before)) {
        seen.after = after;
      } else {
        // A first change, or a run another editor broke: either way it
        // starts here. `set` on a key already present keeps its place, so
        // the order stays the order of first change.
        byField.set(field, { after, before, field });
      }
    }
  }
  return [...byField.values()].filter((c) => !sameValue(c.before, c.after));
}

/**
 * The fields whose values the email may carry. An allow-list, so a field
 * added to the form later reads as a name until someone decides otherwise:
 * the staff inbox is a shared, forwarded mailbox (ADR-0019), so the long
 * markdown fields and the private notes give their name and the edit log
 * link, and so does the image, whose value is a storage key nobody can read.
 */
const VALUE_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "url",
  "contactName",
  "contactEmail",
  "requiresNdaIp",
  "isSponsored",
  "teamsSupported",
]);

export function emailCarriesValue(field: string): boolean {
  return VALUE_FIELDS.has(field);
}

/**
 * A value as the email quotes it: strings in quotes, the rest as words, on
 * one line, since a value with a line break could fake a line of the email.
 */
function quoted(value: unknown): string {
  const text = oneLine(formatEditValue(value));
  return typeof value === "string" && value !== "" ? `"${text}"` : text;
}

/**
 * "1 save at Nov 18, 2026, 2:00 PM", or "4 saves between Nov 18, 2026,
 * 2:00 PM and 2:15 PM", in the office's zone. The second date is dropped when
 * both fall on one day.
 */
export function describeSaveSpan(savedAt: readonly Date[]): string {
  const times = savedAt.map((d) => d.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  const firstText = `${formatOfficeDay(first)}, ${formatOfficeTime(first)}`;
  if (savedAt.length === 1) {
    return `1 save at ${firstText}`;
  }
  const sameDay = formatOfficeDay(first) === formatOfficeDay(last);
  const lastText = sameDay
    ? formatOfficeTime(last)
    : `${formatOfficeDay(last)}, ${formatOfficeTime(last)}`;
  return `${savedAt.length} saves between ${firstText} and ${lastText}`;
}

export interface StaffEditEmailInput {
  /** Where the email's link goes: the project's edit log. */
  editLogUrl: string;
  /**
   * Who made the saves, once each in the order they first saved. Usually one
   * proposer; two when staff reassigned the project during the burst.
   */
  editors: readonly { email: string | null; name: string | null }[];
  /** The project as it stands now, to say where a field has moved on since. */
  live: Readonly<Record<string, unknown>>;
  saves: readonly BurstSave[];
  title: string;
}

/**
 * The email one burst owes the staff inbox, or null when the burst changed
 * nothing on net. A field whose live value differs from the proposer's last
 * save says so: staff edited it since, or the proposer did in a later burst.
 */
export function staffEditEmail(
  input: StaffEditEmailInput
): RenderedEmail | null {
  const lines = netChange(input.saves).flatMap((c): ProposerEditChange[] => {
    const label = projectEditFieldLabel(c.field);
    if (!emailCarriesValue(c.field)) {
      // Printed, not shown, but compared the same way: a legacy row's null
      // saved through the form as "" is no change anyone made.
      const after = formatEditValue(c.after);
      if (formatEditValue(c.before) === after) {
        return [];
      }
      const movedOn = formatEditValue(input.live[c.field]) !== after;
      return [{ label, movedOn, values: null }];
    }
    // Compared as the email prints them: "" and null both read "(empty)",
    // and one-lining folds a trailing space, so a change no reader could see
    // is no line at all.
    const before = quoted(c.before);
    const after = quoted(c.after);
    if (before === after) {
      return [];
    }
    const live = quoted(input.live[c.field]);
    return [
      { label, movedOn: live !== after, values: { after, before, live } },
    ];
  });
  if (lines.length === 0) {
    return null;
  }
  // The template puts the title and each editor's name on one line itself.
  return proposerEditsEmail({
    changes: lines,
    editors: input.editors,
    span: describeSaveSpan(input.saves.map((s) => s.createdAt)),
    title: input.title,
    url: input.editLogUrl,
  });
}
