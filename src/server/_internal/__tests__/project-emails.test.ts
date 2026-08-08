import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTransitionByEmail } from "../project-emails";

const PROJECT = {
  description: "A robot arm.",
  id: "p1",
  proposerEmail: "alex@oregonstate.edu",
  proposerId: null,
  title: "Robot arm",
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("notifyTransitionByEmail", () => {
  it("emails the review inbox when a project is submitted", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send);

    expect(send).toHaveBeenCalledOnce();
    const [to, email] = send.mock.calls[0] ?? [];
    expect(to).toBe("review@oregonstate.edu");
    expect(email.subject).toBe("New project submitted: Robot arm");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("emails the proposer on approval and on changes requested", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "approved", null, true, send);
    await notifyTransitionByEmail(
      PROJECT,
      "changes_requested",
      "Add objectives.",
      true,
      send
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("alex@oregonstate.edu");
    expect(send.mock.calls[1]?.[1].text).toContain("Add objectives.");
  });

  it("sends nothing for statuses that are not part of review", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const send = vi.fn().mockResolvedValue(undefined);

    for (const target of ["draft", "published", "archived"] as const) {
      await notifyTransitionByEmail(PROJECT, target, null, true, send);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when staff opted out", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "approved", null, false, send);

    expect(send).not.toHaveBeenCalled();
  });

  it("skips the submission email when the review inbox is unset", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send);

    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when the review inbox is unset rather than failing silently", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await notifyTransitionByEmail(
      PROJECT,
      "submitted",
      null,
      true,
      vi.fn().mockResolvedValue(undefined)
    );

    // Not cosmetic. With no inbox configured, staff are never told a project
    // was submitted, the transition still succeeds, and nothing else in the app
    // surfaces the gap. The warning is the only signal that exists.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("EMAIL_REVIEW_INBOX");
    warn.mockRestore();
  });

  it("skips everything when the app base url is unset", async () => {
    process.env.BETTER_AUTH_URL = "";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(PROJECT, "submitted", null, true, send);

    expect(send).not.toHaveBeenCalled();
  });

  it("prefers the account address over a stale stored one", async () => {
    // Matches getProposerEmailForEditImpl: proposerId is canonical, so the UI
    // and the mail agree on the recipient. Covered end to end in Task 4.
    const { resolveProposerAddress } = await import("../project-emails");
    expect(resolveProposerAddress("stale@old.edu", "current@x.edu")).toBe(
      "current@x.edu"
    );
    expect(resolveProposerAddress("stored@x.edu", null)).toBe("stored@x.edu");
    expect(resolveProposerAddress(null, null)).toBeNull();
  });

  it("pins what an empty account address does", async () => {
    // resolveProposerAddress uses ?? while getProposerEmailForEditImpl uses a
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
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyTransitionByEmail(
      { ...PROJECT, proposerEmail: null, proposerId: null },
      "approved",
      null,
      true,
      send
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("never propagates a transport failure to the caller", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const send = vi.fn().mockRejectedValue(new Error("SES is down"));

    await expect(
      notifyTransitionByEmail(PROJECT, "approved", null, true, send)
    ).resolves.toBeUndefined();
  });
});
