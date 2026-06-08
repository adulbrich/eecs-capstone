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
});
