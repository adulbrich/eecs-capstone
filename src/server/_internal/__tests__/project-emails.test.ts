import { describe, expect, it, vi } from "vitest";

// `project-emails.ts` statically imports `#/db`, and that module's body throws
// when DATABASE_URL is unset. Locally Vitest loads `.env.local` and supplies
// one, but `.env.local` is gitignored, so CI's unit run has none and merely
// importing the module under test kills the suite. That asymmetry means a
// local `npm test` can never reproduce the failure.
//
// These tests genuinely never reach the database: every case uses a null
// proposerId, so `lookupProposer` short circuits before touching `db`. Mocking
// the module keeps the import harmless without weakening anything asserted
// here. The database-backed paths are covered by the integration suite.
vi.mock("#/db", () => ({ db: {} }));

import type { NotificationConfig } from "#/lib/email/config";
import {
  notifyCommentByEmail,
  notifyHardDeleteByEmail,
  notifyMentorNamedByEmail,
  notifyProposerReassignedByEmail,
  notifyTransitionByEmail,
} from "../project-emails";

// Config is passed as a literal now rather than poked into process.env, which
// is the point of the seam: no mutation, no afterEach restore, and no way for
// one case to leak a variable into the next.
const CONFIG: NotificationConfig = {
  appBaseUrl: "https://app",
  staffInbox: "review@oregonstate.edu",
};
const NO_INBOX: NotificationConfig = { ...CONFIG, staffInbox: null };

// Nobody in these cases is the proposer, so the actor is always staff unless a
// test says otherwise; the owner-withdrawal case below passes the proposer.
const STAFF = "u-staff";

const PROJECT = {
  description: "A robot arm.",
  id: "p1",
  proposerEmail: "alex@oregonstate.edu",
  proposerId: null,
  title: "Robot arm",
};

describe("notifyTransitionByEmail", () => {
  it("emails the staff inbox when a project is submitted", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: null,
        project: PROJECT,
        sendEmail: true,
        target: "submitted",
      },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("review@oregonstate.edu");
    expect(email.subject).toBe("New project submitted: Robot arm");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("emails the proposer on approval and on changes requested", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: null,
        project: PROJECT,
        sendEmail: true,
        target: "approved",
      },
      send,
      CONFIG
    );
    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: "Add objectives.",
        project: PROJECT,
        sendEmail: true,
        target: "changes_requested",
      },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("alex@oregonstate.edu");
    expect(send.mock.calls[1]?.[1].text).toContain("Add objectives.");
  });

  it("sends nothing for statuses that are not part of review", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    for (const target of ["published", "archived"] as const) {
      await notifyTransitionByEmail(
        {
          actorId: STAFF,
          comment: null,
          project: PROJECT,
          sendEmail: true,
          target,
        },
        send,
        CONFIG
      );
    }

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when staff opted out", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: null,
        project: PROJECT,
        sendEmail: false,
        target: "approved",
      },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("skips the submission email when the staff inbox is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: null,
        project: PROJECT,
        sendEmail: true,
        target: "submitted",
      },
      send,
      NO_INBOX
    );

    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when the staff inbox is unset rather than failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: null,
        project: PROJECT,
        sendEmail: true,
        target: "submitted",
      },
      vi.fn().mockResolvedValue(undefined),
      NO_INBOX
    );

    // Not cosmetic. With no inbox configured, staff are never told a project
    // was submitted, the transition still succeeds, and nothing else in the app
    // surfaces the gap. The warning is the only signal that exists.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("EMAIL_STAFF_INBOX");
    warn.mockRestore();
  });

  it("logs a named error when the app base url is unset, and still sends nothing", async () => {
    // BETTER_AUTH_URL used to be skipped silently: no mail, no log, and a
    // review queue nobody was told about. It is required now, and the throw
    // lands in this function's own catch, so the caller is still protected
    // from a failed email undoing a committed transition.
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    // Resolving, not throwing, is the load-bearing half: projects.ts calls
    // this after the transition is committed, so an escaping error would undo
    // nothing but would surface as a failed request on a succeeded approval.
    await expect(
      notifyTransitionByEmail(
        {
          actorId: STAFF,
          comment: null,
          project: PROJECT,
          sendEmail: true,
          target: "submitted",
        },
        send,
        {
          ...CONFIG,
          appBaseUrl: null,
        }
      )
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[1])).toContain("BETTER_AUTH_URL");
    error.mockRestore();
  });

  it("prefers the account address over a stale stored one", async () => {
    // Matches getProposerForEditAs: proposerId is canonical, so the UI
    // and the mail agree on the recipient. Covered end to end in Task 4.
    const { resolveProposerAddress } = await import("../project-emails");
    expect(resolveProposerAddress("stale@old.edu", "current@x.edu")).toBe(
      "current@x.edu"
    );
    expect(resolveProposerAddress("stored@x.edu", null)).toBe("stored@x.edu");
    expect(resolveProposerAddress(null, null)).toBeNull();
  });

  it("pins what an empty account address does", async () => {
    // resolveProposerAddress uses ?? while getProposerForEditAs uses a
    // truthiness check, so an account email of "" resolves differently in the
    // two. user.email is not-null and unique, so this is unreachable in
    // practice; the test exists so that if it ever becomes reachable, the
    // divergence shows up here rather than as mail to the wrong person. The
    // safe direction holds: "" means no address, so nothing is sent.
    const { resolveProposerAddress } = await import("../project-emails");
    expect(resolveProposerAddress("stored@x.edu", "")).toBe("");
    expect(resolveProposerAddress("stored@x.edu", null)).toBe("stored@x.edu");
    expect(resolveProposerAddress(null, null)).toBeNull();
  });

  it("skips the proposer email when there is no address at all", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: null,
        project: { ...PROJECT, proposerEmail: null, proposerId: null },
        sendEmail: true,
        target: "approved",
      },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("never propagates a transport failure to the caller", async () => {
    const send = vi.fn().mockRejectedValue(new Error("SES is down"));

    await expect(
      notifyTransitionByEmail(
        {
          actorId: STAFF,
          comment: null,
          project: PROJECT,
          sendEmail: true,
          target: "approved",
        },
        send,
        CONFIG
      )
    ).resolves.toBeUndefined();
  });
});

describe("notifyTransitionByEmail, returned to draft", () => {
  it("emails the proposer with the staff comment when staff return it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: STAFF,
        comment: "Scope this to one term.",
        project: PROJECT,
        sendEmail: true,
        target: "draft",
      },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("alex@oregonstate.edu");
    expect(email.subject).toBe("Returned to draft: Robot arm");
    expect(email.text).toContain("Scope this to one term.");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("emails nobody when the proposer withdraws their own submission", async () => {
    // The same silence rule as the in-app row: the only person to tell is the
    // one who clicked. Owner withdrawal is submitted -> draft by the owner.
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      {
        actorId: "u-proposer",
        comment: null,
        project: { ...PROJECT, proposerId: "u-proposer" },
        sendEmail: true,
        target: "draft",
      },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });
});

describe("notifyCommentByEmail", () => {
  const comment = {
    content: "Please add a timeline.",
    id: "c1",
    isInternal: false as boolean | null,
  };

  it("emails the proposer when staff comment, linking to the comment", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyCommentByEmail(
      { authorIsStaff: true, comment, project: PROJECT },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("alex@oregonstate.edu");
    expect(email.subject).toBe("New comment on your project: Robot arm");
    expect(email.text).toContain("Please add a timeline.");
    expect(email.text).toContain("https://app/projects/p1#comment-c1");
  });

  it("emails the staff inbox when the proposer comments, and not the proposer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyCommentByEmail(
      { authorIsStaff: false, comment, project: PROJECT },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("review@oregonstate.edu");
    expect(email.subject).toBe("Comment from the proposer: Robot arm");
    expect(email.text).toContain("alex@oregonstate.edu");
    expect(email.text).toContain("https://app/projects/p1#comment-c1");
  });

  it("emails nobody about an internal comment", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyCommentByEmail(
      {
        authorIsStaff: true,
        comment: { ...comment, isInternal: true },
        project: PROJECT,
      },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when the staff inbox is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(
      notifyCommentByEmail(
        { authorIsStaff: false, comment, project: PROJECT },
        send,
        NO_INBOX
      )
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("EMAIL_STAFF_INBOX");
    warn.mockRestore();
  });
});

describe("notifyHardDeleteByEmail", () => {
  it("emails the proposer when staff delete their draft, with no link", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyHardDeleteByEmail(
      { actorId: STAFF, project: PROJECT },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("alex@oregonstate.edu");
    expect(email.subject).toBe("Your draft was deleted: Robot arm");
    // The row is gone, so there is nothing to link to.
    expect(email.text).not.toContain("https://app/projects/p1");
  });

  it("emails nobody when the owner deletes their own draft", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyHardDeleteByEmail(
      {
        actorId: "u-proposer",
        project: { ...PROJECT, proposerId: "u-proposer" },
      },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });
});

describe("notifyProposerReassignedByEmail", () => {
  it("emails the new proposer with a link to the project", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyProposerReassignedByEmail(
      { actorId: STAFF, project: PROJECT },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("alex@oregonstate.edu");
    expect(email.subject).toBe("A project was assigned to you: Robot arm");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("emails nobody when staff assign a project to themselves, or unlink it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyProposerReassignedByEmail(
      { actorId: "u-self", project: { ...PROJECT, proposerId: "u-self" } },
      send,
      CONFIG
    );
    await notifyProposerReassignedByEmail(
      {
        actorId: STAFF,
        project: { ...PROJECT, proposerEmail: null, proposerId: null },
      },
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });
});

describe("notifyMentorNamedByEmail", () => {
  it("emails the named address with a link to the project", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyMentorNamedByEmail(
      {
        mentorEmail: "mentor@example.edu",
        project: { id: "p1", title: "Robot arm" },
      },
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("mentor@example.edu");
    expect(email.subject).toBe("You were named as a mentor: Robot arm");
    expect(email.text).toContain("https://app/projects/p1");
  });
});
