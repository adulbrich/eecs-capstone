/**
 * Reading a live sign-in code out of the database, for the storage-state
 * capture in both browser suites' global setup.
 *
 * The end-to-end suite reads codes out of its server log, which is the honest
 * stand-in for an inbox, but the accessibility suite runs against `npm run dev`,
 * and locally that is whatever dev server the developer already has open: its
 * output goes to their terminal and nowhere this process can read. The
 * `verification` row is the one place both suites can reach. It holds the code
 * encrypted under the Better Auth secret (`storeOTP: "encrypted"`, ADR-0047),
 * so this needs `BETTER_AUTH_SECRET` to match the server's, which it does
 * because both read the same `.env.local`.
 */
import { symmetricDecrypt } from "better-auth/crypto";
import { Pool } from "pg";

/** The live code for `email`, decrypted. Throws when there is none. */
export async function readSignInCode(email: string): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is unset, so the sign-in code cannot be decrypted. Set it in .env.local."
    );
  }
  const row = await withPool((pool) =>
    pool.query<{ value: string }>(
      // Newest first, because a resend inserts a row beside the old one
      // rather than replacing it, and Better Auth checks a code against the
      // newest. An unused code from an earlier run would otherwise be read.
      "select value from verification where identifier = $1 and expires_at > now() order by created_at desc limit 1",
      // Lowercased and not trimmed, which is how Better Auth names the record.
      [`sign-in-otp-${email.toLowerCase()}`]
    )
  );
  const stored = row.rows[0]?.value;
  if (!stored) {
    throw new Error(`no live sign-in code for ${email}`);
  }
  // `<encrypted>:<attempts>`. The ciphertext is hex, so the last colon is the
  // only one.
  const colon = stored.lastIndexOf(":");
  if (colon < 0) {
    throw new Error(
      `the sign-in code for ${email} is not stored as <ciphertext>:<attempts>`
    );
  }
  const encrypted = stored.slice(0, colon);
  return await symmetricDecrypt({ key: secret, data: encrypted });
}

/**
 * Forgets the codes already sent to `email`, so a sign-in during setup is never
 * refused by the per-recipient cap.
 *
 * The cap is five an hour (`SIGN_IN_CODE_LIMIT`), and every run of either
 * browser suite spends one per seeded account it signs in. CI starts from a
 * fresh database each time, but a developer running the smoke set a few times
 * in an hour would find the sixth send swallowed in silence, which the send
 * endpoint answers exactly like a success.
 */
export async function forgetCodeSends(email: string): Promise<void> {
  await withPool((pool) =>
    pool.query("delete from verification_sends where email = $1", [
      email.toLowerCase(),
    ])
  );
}

async function withPool<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}
