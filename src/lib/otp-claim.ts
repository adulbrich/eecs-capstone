/**
 * The claim that ties a pending sign-in code to the browser that asked for it
 * (#581).
 *
 * ## Why a cookie is not enough on its own
 *
 * Better Auth keeps ONE verification record per address, at
 * `sign-in-otp-<address>`, and counts guesses on it. A stranger who knows an
 * address can spend those guesses, and an exhausted record is consumed and not
 * recreated, so the code its owner is holding stops working. ADR-0047 records
 * that.
 *
 * The browser that asks for a code is handed one of these, and has to present
 * it to redeem one. A guess without it is refused in a `hooks.before`, so it
 * never reaches `atomicVerifyOTP` and never spends an attempt, which is the
 * whole of the fix: spending attempts is what destroyed the code.
 *
 * ## What this deliberately does NOT do, and why
 *
 * It does not gate the SEND. That was the first implementation and it was worse
 * than doing nothing, so it is worth writing down. Nobody can prove they own an
 * address at send time, so a stranger who asks FIRST takes the claim on a code
 * that is mailed to somebody else. With the send gated on the claim as well,
 * the owner's correct code was refused AND their own resend was swallowed by
 * the same rule, which turned one unauthenticated request into a lockout for
 * the life of the code: cheaper than the three-guess burn it was written to
 * prevent.
 *
 * So a stranger CAN still rotate the record and earn a claim to it, and the
 * owner's first code is wasted when that happens. What the owner does is ask
 * again, which always works, and their own browser takes the claim. The bound
 * on how often a stranger can force that is the per-recipient mail cap, which
 * ADR-0046 already accepted as a denial of service on the recipient.
 *
 * ## What the token is
 *
 * An HMAC over the address and the record's expiry, under the Better Auth
 * secret. Nothing is stored: the record already holds the only state, and the
 * expiry is what makes one token belong to one code rather than to the address
 * forever. A rotation moves the expiry, so the previous browser's token stops
 * matching, which is what makes a resend from the same browser work and a
 * replay of an old token fail.
 *
 * The expiry is guessable, and that is fine. The secret is what makes the token
 * unforgeable, and it is not in the database, so reading `verification` does not
 * yield a claim to the code in it.
 */

/** Sent to the browser that asked for a code, returned when it redeems one. */
export const OTP_CLAIM_COOKIE = "capstone_otp_claim";

const encoder = new TextEncoder();

const BASE64_PLUS = /\+/g;
const BASE64_SLASH = /\//g;
const BASE64_PADDING = /[=]+$/;

/**
 * The token for one pending code.
 *
 * The address is folded the way Better Auth folds it on every write path, so a
 * capital letter in the sign-in form cannot produce a token that fails to match
 * the one the send issued.
 */
export async function otpClaimToken(
  email: string,
  expiresAt: Date,
  secret: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${email.trim().toLowerCase()}|${expiresAt.getTime()}`)
  );
  return base64Url(new Uint8Array(signed));
}

/**
 * Whether a browser's cookie claims this pending code.
 *
 * Compared in constant time. The comparison is not a secret-bearing one in the
 * usual sense, because an attacker who can measure it can also just ask for a
 * code, but the token IS derived from the secret and a timing oracle on an HMAC
 * comparison is the kind of thing that is cheap to get right and awkward to
 * argue about later.
 */
export function otpClaimMatches(
  presented: string | null | undefined,
  expected: string
): boolean {
  if (!presented || presented.length !== expected.length) {
    return false;
  }
  let differing = 0;
  for (let index = 0; index < expected.length; index += 1) {
    // A constant-time compare is the whole point here, and the branchless
    // form is what makes it one.
    // biome-ignore lint/suspicious/noBitwiseOperators: see above
    differing |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return differing === 0;
}

/** URL-safe base64 without padding, so the value needs no cookie escaping. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(BASE64_PLUS, "-")
    .replace(BASE64_SLASH, "_")
    .replace(BASE64_PADDING, "");
}
