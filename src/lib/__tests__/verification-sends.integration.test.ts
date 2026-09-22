import { describe, expect, it } from "vitest";
import { verificationMailLimits } from "#/lib/verification-mail-limits";
import { reserveVerificationMail } from "#/server/_internal/verification-sends";

// The per-recipient cap on sign-in codes (#554, #576), against a real
// database. The numbers themselves are pinned without one in
// `verification-mail-limits.test.ts`, and the cap as the send path spends it,
// through the real `auth` object, is in `email-otp.integration.test.ts`.

const { limit } = verificationMailLimits();

/** A fresh address per case, so one case cannot spend another's allowance. */
let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `${prefix}-${Date.now()}-${nextAddress}@example.com`;
}

describe("reserveVerificationMail", () => {
  it("allows up to the limit and refuses after it", async () => {
    const email = anAddress("allowance");
    for (let i = 0; i < limit; i += 1) {
      expect(await reserveVerificationMail(email, "sign-in-code")).toBe(true);
    }
    expect(await reserveVerificationMail(email, "sign-in-code")).toBe(false);
  });

  it("counts a recipient under one key whatever case it arrives in", async () => {
    // Better Auth lowercases `user.email`, but the send guard hands over the
    // raw body, and a cap bypassed by one capital letter is not a cap.
    const email = anAddress("folded");
    for (let i = 0; i < limit; i += 1) {
      expect(
        await reserveVerificationMail(email.toUpperCase(), "sign-in-code")
      ).toBe(true);
    }
    expect(await reserveVerificationMail(email, "sign-in-code")).toBe(false);
  });

  it("keeps one recipient's allowance away from another's", async () => {
    const spent = anAddress("spent");
    for (let i = 0; i < limit; i += 1) {
      await reserveVerificationMail(spent, "sign-in-code");
    }
    expect(await reserveVerificationMail(spent, "sign-in-code")).toBe(false);
    expect(
      await reserveVerificationMail(anAddress("untouched"), "sign-in-code")
    ).toBe(true);
  });
});
