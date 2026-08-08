import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleEmailSender } from "../console-sender";

const EMAIL = {
  html: "<p>Hi</p>",
  subject: "Verify your email",
  text: "Hi\n\nVerify email: https://x/verify?t=abc\n",
};

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

  it("writes a block containing the recipient, subject, and text body", async () => {
    const sender = new ConsoleEmailSender();
    await sender.send("a@b.com", EMAIL);
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    expect(output).toContain("a@b.com");
    expect(output).toContain("Verify your email");
    expect(output).toContain(EMAIL.text);
  });

  it("keeps the shape auth.integration.test.ts parses", async () => {
    const sender = new ConsoleEmailSender();
    await sender.send("a@b.com", EMAIL);
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");

    // That suite locates the message by a "subject: <subject>" line and then
    // pulls the link out of a "<call to action>: <url>" line. Both shapes are a
    // contract, not incidental formatting: changing them silently broke the
    // whole integration suite once already, because the assertions above pass
    // on any output that merely mentions the same words.
    expect(output).toContain("subject: Verify your email");
    expect(output).toMatch(/^\s*\S[^\n]*?: https?:\/\/\S+$/m);
  });
});
