import { describe, expect, it, vi } from "vitest";
import { auth } from "#/lib/auth";
import { verificationMailLimits } from "#/lib/verification-mail-limits";
import { reserveVerificationMail } from "#/server/_internal/verification-sends";
import {
  captureConsoleEmail,
  captureStderr,
} from "#/test/shared/console-email";

// The cap on verification mail (#554, piece D), end to end through the real
// `auth` object and a real database. The numbers themselves are pinned without
// one in `verification-mail-limits.test.ts`.

const { limit } = verificationMailLimits("verification");
const PASSWORD = "Password1!";

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
      expect(await reserveVerificationMail(email, "verification")).toBe(true);
    }
    expect(await reserveVerificationMail(email, "verification")).toBe(false);
  });

  it("counts a recipient under one key whatever case it arrives in", async () => {
    // Better Auth lowercases `user.email`, but the two callers hand over
    // whatever they are holding, and a cap bypassed by one capital letter is
    // not a cap.
    const email = anAddress("folded");
    for (let i = 0; i < limit; i += 1) {
      expect(
        await reserveVerificationMail(email.toUpperCase(), "verification")
      ).toBe(true);
    }
    expect(await reserveVerificationMail(email, "verification")).toBe(false);
  });

  it("keeps one recipient's allowance away from another's", async () => {
    const spent = anAddress("spent");
    for (let i = 0; i < limit; i += 1) {
      await reserveVerificationMail(spent, "verification");
    }
    expect(await reserveVerificationMail(spent, "verification")).toBe(false);
    expect(
      await reserveVerificationMail(anAddress("untouched"), "verification")
    ).toBe(true);
  });
});

describe("the cap, through auth", () => {
  it("stops mailing a squatted address once the allowance is gone", async () => {
    const victim = anAddress("squatted");
    // The attacker's sign-up. One message, to the victim.
    await captureConsoleEmail("Verify your email", async () => {
      await auth.api.signUpEmail({
        body: { email: victim, password: PASSWORD, name: "Squatter" },
      });
    });

    // Every refused sign-in mails a fresh link, which is the amplifier #554
    // is about. Spend what is left of the hour.
    for (let i = 0; i < limit - 1; i += 1) {
      await captureConsoleEmail("Verify your email", async () => {
        await expect(
          auth.api.signInEmail({ body: { email: victim, password: PASSWORD } })
        ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
      });
    }

    // The next one sends nothing, and the sign-in is still refused the same
    // way: a capped send is a silent skip, never an error the caller sees.
    //
    // Two capture mechanisms rather than one, because they see different
    // things. `ConsoleEmailSender` writes straight to `process.stderr.write`,
    // which `captureStderr` patches, while `console.warn` goes through
    // Vitest's own console interception and never reaches that patch.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Swallowed so the expected line does not print as noise in the run.
    });
    try {
      const captured = await captureStderr(async () => {
        await expect(
          auth.api.signInEmail({ body: { email: victim, password: PASSWORD } })
        ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
      });
      expect(captured).not.toContain("subject: Verify your email");
      expect(warn).toHaveBeenCalledWith(
        "Verification mail capped for a recipient"
      );
      // The line carries no address, the same rule as the sign-in counter's
      // own (#559).
      expect(warn.mock.calls.flat().join(" ")).not.toContain(victim);
    } finally {
      warn.mockRestore();
    }
  });

  it("tells the real owner when a duplicate sign-up hits an unverified row", async () => {
    const owner = anAddress("duplicate");
    await captureConsoleEmail("Verify your email", async () => {
      await auth.api.signUpEmail({
        body: { email: owner, password: PASSWORD, name: "Squatter" },
      });
    });

    // Better Auth answers this with a synthetic success, so the response is
    // indistinguishable from a real sign-up. The mail is the only difference,
    // and it goes to the inbox rather than to the caller.
    const url = await captureConsoleEmail(
      "Someone signed up with your email address",
      async () => {
        await auth.api.signUpEmail({
          body: {
            email: owner,
            password: "DifferentPass1!",
            name: "Real Owner",
          },
        });
      }
    );
    expect(new URL(url).pathname).toBe("/forgot-password");
    // No token: one for this row would confirm the SQUATTER's account and, with
    // autoSignInAfterVerification, sign the owner into it.
    expect(new URL(url).search).toBe("");
  });

  it("cannot be silenced by a squatter spending the verification budget", async () => {
    // Found in review. With one shared allowance, a squatter emptied the hour
    // with a sign-up and two sign-ins, and the real owner's own sign-up then
    // produced nothing at all: Better Auth answers a duplicate with a synthetic
    // success, so they saw "account created" and heard nothing. The two kinds
    // are metered apart so that cannot happen.
    const victim = anAddress("suppression");
    await captureConsoleEmail("Verify your email", async () => {
      await auth.api.signUpEmail({
        body: { email: victim, password: PASSWORD, name: "Squatter" },
      });
    });
    // `sendOnSignIn` mails a fresh link on every sign-in with the password the
    // squatter chose, and that path is deliberately outside the #552 attempt
    // counter, so it costs them nothing. Empty the verification allowance.
    for (let i = 0; i < limit; i += 1) {
      await auth.api
        .signInEmail({ body: { email: victim, password: PASSWORD } })
        .catch(() => {
          // Refused as unverified every time; the mail is the point.
        });
    }
    expect(await reserveVerificationMail(victim, "verification")).toBe(false);

    // The owner signs up, and still hears about it.
    const url = await captureConsoleEmail(
      "Someone signed up with your email address",
      async () => {
        await auth.api.signUpEmail({
          body: {
            email: victim,
            password: "DifferentPass1!",
            name: "Real Owner",
          },
        });
      }
    );
    expect(new URL(url).pathname).toBe("/forgot-password");
  });

  it("says nothing when the duplicate hits a verified row", async () => {
    const owner = anAddress("verified-duplicate");
    const verifyUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await auth.api.signUpEmail({
          body: { email: owner, password: PASSWORD, name: "Real Owner" },
        });
      }
    );
    await auth.api.verifyEmail({
      query: {
        token: new URL(verifyUrl).searchParams.get("token") as string,
      },
    });

    const captured = await captureStderr(async () => {
      await auth.api.signUpEmail({
        body: { email: owner, password: "DifferentPass1!", name: "Stranger" },
      });
    });
    // A confirmed account belongs to somebody, and telling them about every
    // stranger who typed their address is noise.
    expect(captured).not.toContain("Someone signed up with your email address");
  });
});
