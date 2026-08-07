import { describe, expect, it, vi } from "vitest";
import { SesEmailSender } from "../ses-sender";

const EMAIL = {
  html: "<p>Hi</p>",
  subject: "Verify your email",
  text: "Hi\n\nVerify email: https://x/verify?t=abc\n",
};

describe("SesEmailSender", () => {
  it("sends from the configured identity to the recipient", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", sendCommand);

    await sender.send("a@b.com", EMAIL);

    expect(sendCommand).toHaveBeenCalledOnce();
    const input = sendCommand.mock.calls[0]?.[0];
    expect(input.FromEmailAddress).toBe("noreply@example.edu");
    expect(input.Destination.ToAddresses).toEqual(["a@b.com"]);
  });

  it("passes the rendered subject and both bodies through unchanged", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", sendCommand);

    await sender.send("a@b.com", EMAIL);

    const simple = sendCommand.mock.calls[0]?.[0].Content.Simple;
    expect(simple.Subject.Data).toBe("Verify your email");
    expect(simple.Body.Text.Data).toBe(EMAIL.text);
    expect(simple.Body.Html.Data).toBe(EMAIL.html);
  });

  it("omits the reply-to header entirely when none is configured", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender("noreply@example.edu", sendCommand);

    await sender.send("a@b.com", EMAIL);

    expect(sendCommand.mock.calls[0]?.[0].ReplyToAddresses).toBeUndefined();
  });

  it("sets the reply-to header when one is configured", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const sender = new SesEmailSender(
      "noreply@example.edu",
      sendCommand,
      "replies@example.edu"
    );

    await sender.send("a@b.com", EMAIL);

    expect(sendCommand.mock.calls[0]?.[0].ReplyToAddresses).toEqual([
      "replies@example.edu",
    ]);
  });
});
