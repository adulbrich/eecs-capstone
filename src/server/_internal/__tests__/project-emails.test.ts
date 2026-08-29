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
import { notifyTransitionByEmail } from "../project-emails";

// Config is passed as a literal now rather than poked into process.env, which
// is the point of the seam: no mutation, no afterEach restore, and no way for
// one case to leak a variable into the next.
const CONFIG: NotificationConfig = {
  appBaseUrl: "https://app",
  reviewInbox: "review@oregonstate.edu",
};
const NO_INBOX: NotificationConfig = { ...CONFIG, reviewInbox: null };

const PROJECT = {
  description: "A robot arm.",
  id: "p1",
  proposerEmail: "alex@oregonstate.edu",
  proposerId: null,
  title: "Robot arm",
};

describe("notifyTransitionByEmail", () => {
  it("emails the review inbox when a project is submitted", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      PROJECT,
      "submitted",
      null,
      true,
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
      PROJECT,
      "approved",
      null,
      true,
      send,
      CONFIG
    );
    await notifyTransitionByEmail(
      PROJECT,
      "changes_requested",
      "Add objectives.",
      true,
      send,
      CONFIG
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("alex@oregonstate.edu");
    expect(send.mock.calls[1]?.[1].text).toContain("Add objectives.");
  });

  it("sends nothing for statuses that are not part of review", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    for (const target of ["draft", "published", "archived"] as const) {
      await notifyTransitionByEmail(PROJECT, target, null, true, send, CONFIG);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when staff opted out", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      PROJECT,
      "approved",
      null,
      false,
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("skips the submission email when the review inbox is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      PROJECT,
      "submitted",
      null,
      true,
      send,
      NO_INBOX
    );

    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when the review inbox is unset rather than failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await notifyTransitionByEmail(
      PROJECT,
      "submitted",
      null,
      true,
      vi.fn().mockResolvedValue(undefined),
      NO_INBOX
    );

    // Not cosmetic. With no inbox configured, staff are never told a project
    // was submitted, the transition still succeeds, and nothing else in the app
    // surfaces the gap. The warning is the only signal that exists.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("EMAIL_REVIEW_INBOX");
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

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send, {
      ...CONFIG,
      appBaseUrl: null,
    });

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
      { ...PROJECT, proposerEmail: null, proposerId: null },
      "approved",
      null,
      true,
      send,
      CONFIG
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("never propagates a transport failure to the caller", async () => {
    const send = vi.fn().mockRejectedValue(new Error("SES is down"));

    await expect(
      notifyTransitionByEmail(PROJECT, "approved", null, true, send, CONFIG)
    ).resolves.toBeUndefined();
  });
});
