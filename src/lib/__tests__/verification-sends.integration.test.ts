import { describe, expect, it } from "vitest";
import { verificationMailLimits } from "#/lib/verification-mail-limits";
import {
  refundVerificationMail,
  reserveVerificationMail,
} from "#/server/_internal/verification-sends";

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
      expect(await reserveVerificationMail(email)).toBe(true);
    }
    expect(await reserveVerificationMail(email)).toBe(false);
  });

  it("counts a recipient under one key whatever case it arrives in", async () => {
    // Better Auth lowercases `user.email`, but the send guard hands over the
    // raw body, and a cap bypassed by one capital letter is not a cap.
    const email = anAddress("folded");
    for (let i = 0; i < limit; i += 1) {
      expect(await reserveVerificationMail(email.toUpperCase())).toBe(true);
    }
    expect(await reserveVerificationMail(email)).toBe(false);
  });

  it("keeps one recipient's allowance away from another's", async () => {
    const spent = anAddress("spent");
    for (let i = 0; i < limit; i += 1) {
      await reserveVerificationMail(spent);
    }
    expect(await reserveVerificationMail(spent)).toBe(false);
    expect(await reserveVerificationMail(anAddress("untouched"))).toBe(true);
  });
});

describe("refundVerificationMail", () => {
  it("gives back one reservation per call, even when the calls race", async () => {
    // A burst of sends Better Auth refuses after the guard: every one reserves,
    // then every one refunds at once. Two refunds that picked the same newest
    // row gave back one reservation between them, and each collision left a
    // row counting against the recipient for the rest of the window.
    const email = anAddress("refunded");
    for (let i = 0; i < limit; i += 1) {
      await reserveVerificationMail(email);
    }

    // Two fewer refunds than reservations, so a refund that gave back more
    // than one row fails this as surely as two that gave back the same one.
    const refunds = limit - 2;
    await Promise.all(
      Array.from({ length: refunds }, () => refundVerificationMail(email))
    );

    for (let i = 0; i < refunds; i += 1) {
      expect(await reserveVerificationMail(email)).toBe(true);
    }
    expect(await reserveVerificationMail(email)).toBe(false);
  });
});
