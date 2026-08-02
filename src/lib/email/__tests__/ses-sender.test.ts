import { describe, expect, it, vi } from "vitest";
import { SesEmailSender } from "../ses-sender";

describe("SesEmailSender", () => {
  it("sends a verification email from the configured sender to the recipient with the url", async () => {
    const send = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", send);

    await sender.sendVerification({
      to: "a@b.com",
      url: "https://x/verify?t=abc",
    });

    expect(send).toHaveBeenCalledOnce();
    const input = send.mock.calls[0]?.[0];
    expect(input.FromEmailAddress).toBe("noreply@example.edu");
    expect(input.Destination.ToAddresses).toEqual(["a@b.com"]);
    expect(JSON.stringify(input.Content)).toContain("https://x/verify?t=abc");
  });

  it("sends a password-reset email containing the url", async () => {
    const send = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", send);

    await sender.sendPasswordReset({
      to: "a@b.com",
      url: "https://x/reset?t=abc",
    });

    const input = send.mock.calls[0]?.[0];
    expect(JSON.stringify(input.Content)).toContain("https://x/reset?t=abc");
  });

  it("sets ReplyToAddresses when a reply-to is configured", async () => {
    const send = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender(
      "noreply@example.edu",
      send,
      "capstone@example.edu"
    );

    await sender.sendVerification({ to: "a@b.com", url: "https://x/v" });

    const input = send.mock.calls[0]?.[0];
    expect(input.ReplyToAddresses).toEqual(["capstone@example.edu"]);
    // The From address is what DKIM aligns against, so a reply-to must never
    // displace it.
    expect(input.FromEmailAddress).toBe("noreply@example.edu");
  });

  it("omits ReplyToAddresses entirely when no reply-to is configured", async () => {
    const send = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", send);

    await sender.sendPasswordReset({ to: "a@b.com", url: "https://x/r" });

    // Not an empty array: the field has to be absent from the request, so SES
    // falls back to the From address the way it does today.
    expect(send.mock.calls[0]?.[0].ReplyToAddresses).toBeUndefined();
  });
});
