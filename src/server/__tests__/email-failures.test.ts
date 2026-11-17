import { afterEach, describe, expect, it, vi } from "vitest";
import { redactingAuthLogger } from "#/lib/_internal/redact-query-error";
import type { NotificationConfig } from "#/lib/email/config";
import {
  notifyBannedByEmail,
  notifyRoleChangedByEmail,
} from "#/server/_internal/account-emails";
import {
  notifyInventoryByEmail,
  notifyRequestSubmittedByEmail,
} from "#/server/_internal/inventory-emails";
import {
  notifyCommentByEmail,
  notifyHardDeleteByEmail,
  notifyMentorNamedByEmail,
  notifyProposerReassignedByEmail,
  notifyTransitionByEmail,
} from "#/server/_internal/project-emails";
import {
  ANCHORED_REGEX,
  metricFilterMatches,
  metricFilterPattern,
} from "#/test/shared/metric-filter";

// `project-emails.ts` imports `#/db`, whose body throws without DATABASE_URL,
// and CI's unit run has none. Every case below uses a null proposerId, so no
// notifier reaches the database.
vi.mock("#/db", () => ({ db: {} }));

// The sign-in code's line is printed inside the `auth` instance, which a unit
// test cannot build; `email-otp-send-failure.integration.test.ts` runs this
// pattern on it instead.

const pattern = () => metricFilterPattern("email_failures");
const counted = (line: string) => metricFilterMatches(pattern(), line);

const CONFIG: NotificationConfig = {
  appBaseUrl: "https://app",
  staffInbox: "staff@oregonstate.edu",
};
const PROJECT = {
  description: "A robot arm.",
  id: "p1",
  proposerEmail: "alex@oregonstate.edu",
  proposerId: null,
  title: "Robot arm",
};
const STAFF = "u-staff";

const sesDown = () => Promise.reject(new Error("SES is down"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the email_failures metric filter in infra/alarms.tf", () => {
  it("is an anchored regex in the subset metricFilterMatches imitates", () => {
    expect(pattern()).toMatch(ANCHORED_REGEX);
    for (const alternative of pattern().slice(1, -1).split("|")) {
      expect(alternative).toMatch(/^\^/u);
    }
  });

  it.each([
    {
      notifier: "notifyTransitionByEmail",
      printed: /^Review email failed for project p1$/u,
      fail: () =>
        notifyTransitionByEmail(
          {
            actorId: STAFF,
            comment: null,
            project: PROJECT,
            sendEmail: true,
            target: "approved",
          },
          sesDown,
          CONFIG
        ),
    },
    {
      notifier: "notifyCommentByEmail",
      printed: /^Comment email failed for project p1$/u,
      fail: () =>
        notifyCommentByEmail(
          {
            authorIsStaff: true,
            comment: {
              authorId: STAFF,
              content: "Add a timeline.",
              id: "c1",
              isInternal: false,
            },
            project: PROJECT,
          },
          sesDown,
          CONFIG
        ),
    },
    {
      notifier: "notifyHardDeleteByEmail",
      printed: /^Delete email failed for project p1$/u,
      fail: () =>
        notifyHardDeleteByEmail({ actorId: STAFF, project: PROJECT }, sesDown),
    },
    {
      notifier: "notifyProposerReassignedByEmail",
      printed: /^Reassignment email failed for project p1$/u,
      fail: () =>
        notifyProposerReassignedByEmail(
          { actorId: STAFF, project: PROJECT },
          sesDown,
          CONFIG
        ),
    },
    {
      notifier: "notifyMentorNamedByEmail",
      printed: /^Mentor email failed for project p1$/u,
      fail: () =>
        notifyMentorNamedByEmail(
          {
            mentorEmail: "mentor@example.com",
            project: { id: "p1", title: "Robot arm" },
          },
          sesDown,
          CONFIG
        ),
    },
    {
      notifier: "notifyInventoryByEmail",
      printed: /^Inventory email failed \(inventory_request_approved\)$/u,
      fail: () =>
        notifyInventoryByEmail(
          {
            link: "/my/items",
            message: "Your request was approved.",
            recipient: { accountId: null, email: "walkin@example.com" },
            title: "Reserved",
            type: "inventory_request_approved",
          },
          { send: sesDown },
          CONFIG
        ),
    },
    {
      notifier: "notifyRequestSubmittedByEmail",
      printed: /^Request notice failed for request req-1$/u,
      fail: () =>
        notifyRequestSubmittedByEmail(
          {
            id: "req-1",
            lines: ["Raspberry Pi 5"],
            requester: { email: "student@example.com", name: "Sam" },
          },
          "cart",
          sesDown,
          CONFIG
        ),
    },
    {
      notifier: "notifyRoleChangedByEmail",
      printed: /^Role change email failed$/u,
      fail: () =>
        notifyRoleChangedByEmail(
          { role: "staff", to: "someone@example.com" },
          sesDown,
          CONFIG
        ),
    },
    {
      notifier: "notifyBannedByEmail",
      printed: /^Ban email failed$/u,
      fail: () =>
        notifyBannedByEmail(
          { expiresAt: null, reason: "Spam", to: "someone@example.com" },
          sesDown
        ),
    },
  ])(
    "counts the one line $notifier prints when SES refuses",
    async ({ printed, fail }) => {
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await fail();

      // The message is the first argument; the redacted error follows it on
      // the same line, so CloudWatch sees `<message> <error>`.
      const lines = error.mock.calls.map((call) => call.join(" "));
      expect(error.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(printed),
      ]);
      expect(lines.filter(counted)).toHaveLength(1);
    }
  );

  it.each([
    "Refunding a sign-in code send failed Error: connection terminated",
    "Verification mail counter failed Error: connection terminated",
  ])("does not count the sign-in counter failing: %j", (line) => {
    // Neither is lost mail: the send they sit beside went out, or was
    // refused for a reason a counter cannot change.
    expect(counted(line)).toBe(false);
  });

  it.each([
    "Invalid callbackURL: https://x.invalid/Ban email failed",
    "Invalid origin: Sending a sign-in code failed",
    "Invalid callbackURL: x\nRole change email failed",
    "Invalid callbackURL: x\r\nReview email failed for project p1",
  ])(
    "does not count a Better Auth line carrying a stranger's text: %j",
    (message) => {
      // Better Auth logs a rejected callbackURL or Origin word for word, and
      // awslogs makes each line of a write its own event.
      const written: string[] = [];
      redactingAuthLogger((line) => written.push(line))("error", message);

      const events = written.join("\n").split("\n");
      expect(events).toHaveLength(1);
      expect(events.filter(counted)).toEqual([]);
    }
  );
});
