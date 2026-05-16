import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleEmailSender } from "../console-sender";

describe("ConsoleEmailSender", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("writes a verification block containing the recipient and url", async () => {
    const sender = new ConsoleEmailSender();
    await sender.sendVerification({
      to: "a@b.com",
      url: "https://x/verify?t=abc",
    });
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    expect(output).toContain("VERIFY EMAIL");
    expect(output).toContain("a@b.com");
    expect(output).toContain("https://x/verify?t=abc");
  });

  it("writes a password-reset block containing the recipient and url", async () => {
    const sender = new ConsoleEmailSender();
    await sender.sendPasswordReset({
      to: "a@b.com",
      url: "https://x/reset?t=abc",
    });
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    expect(output).toContain("RESET PASSWORD");
    expect(output).toContain("a@b.com");
    expect(output).toContain("https://x/reset?t=abc");
  });
});
