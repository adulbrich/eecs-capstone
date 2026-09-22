import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "#/db";
import { signInAttempts } from "#/db/schema";
import {
  type SignInVerdict,
  signInLimits,
  signInVerdict,
  UNRESOLVED_IP,
} from "#/lib/sign-in-limits";

/**
 * The queries behind the sign-in attempt limit (#552). The decision itself is
 * in `src/lib/sign-in-limits.ts`, which imports nothing, so the numbers can be
 * unit tested without a database.
 */

/** Both halves of the key, normalised the one way Better Auth normalises them. */
export function attemptKey(
  email: unknown,
  ip: string | null
): { email: string; ip: string } {
  return {
    // Better Auth looks users up with `email.toLowerCase()`
    // (`db/internal-adapter.mjs`), so a counter that did not lowercase would be
    // bypassed by changing one letter's case. Trimmed too, because the sign-in
    // form sends whatever was typed.
    email: typeof email === "string" ? email.trim().toLowerCase() : "",
    ip: ip ?? UNRESOLVED_IP,
  };
}

/**
 * Whether this pair may attempt a sign-in right now.
 *
 * Counts failures only. A successful sign-in clears the pair, so a person who
 * gets in is never carrying a count, and someone typing one wrong password
 * between successful sign-ins never accumulates.
 */
export async function checkSignInAllowed(
  email: string,
  ip: string
): Promise<SignInVerdict> {
  const limits = signInLimits();
  const [row] = await db
    .select({
      failures: sql<string>`count(*)`,
      // The delay is measured from the newest failure, so the query has to
      // return it. Counting alone would leave the pair refused until its
      // failures aged out of the window instead of for the configured delay.
      lastAt: sql<Date | null>`max(${signInAttempts.createdAt})`,
    })
    .from(signInAttempts)
    .where(
      and(
        eq(signInAttempts.email, email),
        eq(signInAttempts.ip, ip),
        gt(
          signInAttempts.createdAt,
          sql`now() - make_interval(mins => ${limits.windowMinutes})`
        )
      )
    );
  return signInVerdict(
    {
      count: Number(row?.failures ?? 0),
      lastAt: row?.lastAt ? new Date(row.lastAt) : null,
    },
    limits
  );
}

/**
 * Records one failure, and opportunistically prunes rows that have aged out.
 *
 * The prune is bounded to this pair rather than the whole table so it stays on
 * the index and cannot turn a sign-in into a sequential scan. Rows for a pair
 * that never attempts again are therefore left behind; they are three short
 * columns and nothing reads them, so a periodic sweep is not worth a scheduler.
 * Both statements are best effort by design: see `swallowing` below.
 */
export async function recordFailedSignIn(
  email: string,
  ip: string
): Promise<void> {
  const limits = signInLimits();
  await db.insert(signInAttempts).values({ email, ip });
  // One line per recorded failure, carrying no address and no email, so that a
  // fleet-wide count per minute is a single Logs Insights query (#552). The
  // per-pair counter above cannot see password spraying: one guess against
  // each of ten thousand addresses trips no pair, and under campus NAT a
  // per-address number cannot see it either. A count can. The identifiers are
  // left out on purpose rather than forgotten, because #559 exists to keep
  // this class of value out of the log group; the row above already holds
  // them for anyone with database access.
  console.warn("Failed sign-in recorded");
  await db
    .delete(signInAttempts)
    .where(
      and(
        eq(signInAttempts.email, email),
        eq(signInAttempts.ip, ip),
        lt(
          signInAttempts.createdAt,
          sql`now() - make_interval(mins => ${limits.windowMinutes})`
        )
      )
    );
}

/** Clears the pair. Called when a sign-in succeeds. */
export async function clearSignInAttempts(
  email: string,
  ip: string
): Promise<void> {
  await db
    .delete(signInAttempts)
    .where(and(eq(signInAttempts.email, email), eq(signInAttempts.ip, ip)));
}
