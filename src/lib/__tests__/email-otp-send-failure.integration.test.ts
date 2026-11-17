import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { verificationSends } from "#/db/schema";
import { auth } from "#/lib/auth";
import type { RenderedEmail } from "#/lib/email/templates";
import { captureConsoleCode } from "#/test/shared/console-email";
import {
  metricFilterMatches,
  metricFilterPattern,
} from "#/test/shared/metric-filter";

// #892: a sign-in code whose mail failed in SES. Its own file because the
// failure is a module mock of the sender, which `auth` reads once at import.

const mail = vi.hoisted(() => ({
  /** When set, every send rejects the way a refused SES call does. */
  fails: false,
  /** The code each rejected send was carrying, which nobody received. */
  lost: [] as string[],
}));

vi.mock("#/lib/email/sender", async (importOriginal) => {
  const real = await importOriginal<typeof import("#/lib/email/sender")>();
  const console = real.getEmailSender();
  return {
    ...real,
    getEmailSender: () => ({
      send: async (to: string, email: RenderedEmail) => {
        if (mail.fails) {
          mail.lost.push(email.text.match(/(\d{6})/u)?.[1] ?? "");
          throw new Error("MessageRejected: Email address is not verified.");
        }
        await console.send(to, email);
      },
    }),
  };
});

afterEach(() => {
  mail.fails = false;
  mail.lost.length = 0;
  vi.restoreAllMocks();
});

const ORIGIN = "http://localhost:3000";

let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `otp-lost-${prefix}-${Date.now()}-${nextAddress}@example.com`;
}

/** A send through the router, as the code form makes it. */
function postSend(email: string): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
      body: JSON.stringify({ email, type: "sign-in" }),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    })
  );
}

function claimFrom(response: Response): string | undefined {
  return response.headers.get("set-cookie")?.split(";")[0];
}

async function sendsSpentBy(email: string): Promise<number> {
  const rows = await db
    .select({ id: verificationSends.id })
    .from(verificationSends)
    .where(eq(verificationSends.email, email.toLowerCase()));
  return rows.length;
}

/** A send whose mail SES refuses, and the lines it printed. */
async function failedSend(
  email: string
): Promise<{ lines: string[]; response: Response }> {
  mail.fails = true;
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await postSend(email);
  mail.fails = false;
  const lines = error.mock.calls.map((call) => call.join(" "));
  error.mockRestore();
  return { lines, response };
}

describe("a sign-in code whose mail failed", () => {
  it("gives the send back, and still answers success", async () => {
    const email = anAddress("refund");
    // The control: a send that mails spends one and hands out a claim.
    let delivered: Response | undefined;
    await captureConsoleCode(async () => {
      delivered = await postSend(email);
    });
    expect(await sendsSpentBy(email)).toBe(1);
    expect(delivered && claimFrom(delivered)).toBeTruthy();

    const { response } = await failedSend(email);

    expect(mail.lost).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await sendsSpentBy(email)).toBe(1);
  });

  it("prints one line the email_failures alarm counts", async () => {
    const { lines } = await failedSend(anAddress("alarm"));

    expect(
      lines.some((line) => line.startsWith("Sending a sign-in code failed"))
    ).toBe(true);
    const pattern = metricFilterPattern("email_failures");
    expect(
      lines.filter((line) => metricFilterMatches(pattern, line))
    ).toHaveLength(1);
  });

  it("leaves the whole hour's sends after an outage longer than the cap", async () => {
    const email = anAddress("outage");
    const limit = Number(process.env.SIGN_IN_CODE_LIMIT ?? 5);

    for (let attempt = 0; attempt <= limit; attempt += 1) {
      await failedSend(email);
    }

    expect(mail.lost).toHaveLength(limit + 1);
    expect(await sendsSpentBy(email)).toBe(0);
    expect(await captureConsoleCode(() => postSend(email))).toHaveLength(6);
  });

  it("hands out no claim, so nobody can redeem the code it wrote", async () => {
    const email = anAddress("claim");
    let first: Response | undefined;
    await captureConsoleCode(async () => {
      first = await postSend(email);
    });
    const earlierClaim = first && claimFrom(first);
    expect(earlierClaim).toBeTruthy();

    const { response } = await failedSend(email);
    expect(claimFrom(response)).toBeUndefined();

    // The failed send's code is free now, so redeeming it must be impossible
    // from any browser: with the claim an earlier send gave, or with none.
    const [lostCode] = mail.lost;
    for (const headers of [
      new Headers({ cookie: earlierClaim ?? "" }),
      new Headers(),
    ]) {
      await expect(
        auth.api.signInEmailOTP({
          body: { email, name: "Stranger", otp: lostCode ?? "" },
          headers,
        })
      ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    }
  });
});
