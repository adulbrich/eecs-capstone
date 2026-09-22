import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, emailOTP, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { z } from "zod";
import { db } from "#/db";
import {
  buildAuthConfig,
  warnUnconfiguredProviders,
} from "#/lib/_internal/auth-config";
import { authRateLimit } from "#/lib/_internal/auth-rate-limits";
import {
  type OnidProfile,
  onidProfileFromIdToken,
} from "#/lib/_internal/onid-profile";
import {
  redactingAuthLogger,
  redactQueryError,
} from "#/lib/_internal/redact-query-error";
import { requireUserName } from "#/lib/_internal/user-name";
import { getEmailSender } from "#/lib/email/sender";
import { signInCodeEmail } from "#/lib/email/templates";
import {
  OTP_CLAIM_COOKIE,
  otpClaimMatches,
  otpClaimToken,
} from "#/lib/otp-claim";
import type { UserRole } from "#/lib/vocabularies";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";
import { otpSignInRefused } from "#/server/_internal/otp-sign-in-guard";
import { releaseUnverifiedAddress } from "#/server/_internal/release-unverified-address";
import {
  refundVerificationMail,
  reserveVerificationMail,
} from "#/server/_internal/verification-sends";

const emailSender = getEmailSender();

const authConfig = buildAuthConfig();

// Said once, at boot, rather than once per failed sign-in. GitHub is optional
// everywhere and ONID outside production, so this is the only signal that one
// of them is off by accident; `src/nitro/config-check.ts` refuses to boot a
// production task without ONID before this line runs.
warnUnconfiguredProviders(authConfig.unconfigured);

/**
 * Claims a newly verified user's projects, swallowing any failure.
 *
 * The swallow is load-bearing rather than defensive habit. Better Auth runs
 * `create.after` hooks in a loop with no try/catch of its own, so an exception
 * escaping here would break account creation. Claiming is also idempotent, so
 * the next code sign-in retries it for free. An account that only ever signs in
 * with ONID or GitHub has no such retry: nothing claims after its creation, so
 * a claim that fails there waits for staff to link the project by hand.
 */
async function claimProjectsFor(userId: string, email: string): Promise<void> {
  try {
    await claimProjectsForVerifiedUser(userId, email);
  } catch (error) {
    console.error(
      `Claiming projects failed for user ${userId}`,
      redactQueryError(error)
    );
  }
}

/** Where an emailed code is redeemed (#576). Guarded below, for the two rows
 * Better Auth's own helper does not refuse; see `otp-sign-in-guard.ts`. */
const CODE_SIGN_IN = "/sign-in/email-otp";

/** Where a code is asked for, and where the claim cookie is issued (#581). */
const CODE_SEND = "/email-otp/send-verification-otp";

/**
 * Where a code is checked without being spent, which the sign-in form uses to
 * find out it should ask a new address for a name before redeeming.
 *
 * It counts a wrong guess against the same record `/sign-in/email-otp` does, so
 * it is guarded identically. Leaving it out would have left the whole of #581
 * open through a second door.
 */
const CODE_CHECK = "/email-otp/check-verification-otp";

/** As long as a code lives, and no longer: the claim is useless after that. */
const CLAIM_COOKIE_SECONDS = 300;

/** Better Auth's identifier for a pending sign-in code, from `toOTPIdentifier`. */
function codeRecordFor(email: string): string {
  // Lowercased and NOT trimmed, which matches `toOTPIdentifier`'s callers
  // exactly: every handler in `routes.mjs` does `ctx.body.email.toLowerCase()`
  // and nothing trims. Trimming here looked up a different row than Better
  // Auth would, so a padded address resolved to the unpadded owner's live
  // record. `z.email()` rejects the padded form a moment later, so nothing was
  // spent, but the two must name the same row or this guard is guarding
  // somebody else's code.
  return `sign-in-otp-${email.toLowerCase()}`;
}

/**
 * The secret the claim token is signed with.
 *
 * `BETTER_AUTH_SECRET` in production, where `src/lib/_internal/startup-config.ts`
 * refuses to boot without it. A per-process random value otherwise, rather than
 * a fixed development default: a claim only has to outlive the five minutes its
 * code does, so losing them all on a restart costs a developer one resend, and
 * a checked-in default would be a signing key in the repository.
 */
const claimSecret =
  process.env.BETTER_AUTH_SECRET ?? crypto.randomUUID() + crypto.randomUUID();

/**
 * The shape of the request both code guards read. Structural rather than Better
 * Auth's own middleware context type, so these stay callable from a test.
 */
interface CodeRequest {
  body?: {
    email?: unknown;
    image?: unknown;
    name?: unknown;
    otp?: unknown;
    type?: unknown;
  };
  context: {
    internalAdapter: {
      findVerificationValue: (
        id: string
      ) => Promise<{ expiresAt: Date } | null | undefined>;
    };
  };
  getCookie: (name: string) => string | null | undefined;
  path: string;
}

/**
 * Whether a request for a code may reach Better Auth at all (#581).
 *
 * The refusal answers `{success: true}` at the call site, because the send
 * endpoint has to look the same whatever it decides or it becomes an account
 * enumerator.
 *
 * ## Why the CLAIM is not consulted here, only at redeem
 *
 * It was, and that was wrong in a way worth recording, because "a live code
 * belongs to the browser that asked for it" sounds like the stronger rule.
 * Nobody can prove they own an address at send time, so a stranger who sends
 * FIRST takes the claim for a code that is mailed to somebody else: the owner's
 * correct code was then refused, AND their own resend was swallowed by the same
 * rule, so one unauthenticated request locked them out for the life of the
 * code. That is a cheaper denial than the one #581 exists to close.
 *
 * Leaving the send open costs nothing the mail cap was not already accepting.
 * A stranger's send rotates the record and mails the owner the new code. The
 * owner cannot redeem that one, because its claim went to the stranger's
 * browser, but asking again works, while they have a send left in the hour, and
 * takes the claim back. What they cannot do is outrun the per-recipient cap,
 * which is ADR-0046's accepted tradeoff and predates all of this.
 */
async function codeSendAllowed(ctx: CodeRequest): Promise<boolean> {
  const address = signInCodeAddress(ctx);
  if (address === null) {
    // Refused rather than passed through. `type` is the caller's to choose,
    // and every other value names a DIFFERENT verification record that this
    // app has no flow for: letting those through was an uncapped way to make
    // Better Auth write rows, outside the per-recipient cap, for a code
    // `sendVerificationOTP` would then decline to mail.
    return false;
  }
  // The cap is spent HERE rather than inside `sendVerificationOTP`, because
  // `resolveOTP` writes the rotated record BEFORE the sender runs. Refusing
  // down there left the record holding a code nobody had been told, so a sixth
  // request in an hour did not merely fail to mail: it killed the code the
  // person was already holding.
  return await mayMail(address);
}

/**
 * Whether a guess against a code must be refused before Better Auth counts it.
 *
 * Two reasons, and the caller gives both the shape of a wrong code.
 * `otp-sign-in-guard.ts` says why the row guard cannot say more; the claim
 * guard cannot either, because a distinct refusal would tell a stranger
 * whether a code is outstanding for an address.
 */
async function codeGuessRefused(ctx: CodeRequest): Promise<boolean> {
  const address = signInCodeAddress(ctx);
  if (address === null) {
    // `/sign-in/email-otp` sends no `type` and is always the sign-in record;
    // `/email-otp/check-verification-otp` takes one from the caller and keys
    // its own lookup on it. Guarding only the sign-in record while the handler
    // reads another was a way to spend guesses this guard never saw, so any
    // other type is refused outright.
    return true;
  }
  try {
    const expected = await expectedClaim(ctx, address);
    // No live record means there is nothing to claim, so Better Auth answers
    // and a missing code and an unclaimed one come from the same place.
    //
    // This is the whole of #581: a guess from a browser that does not hold the
    // claim is refused HERE, before Better Auth counts it against the record.
    // The count is what a stranger was spending, and an exhausted record is
    // consumed and not recreated, so spending it destroyed the owner's code.
    const unclaimed =
      expected !== null &&
      !otpClaimMatches(ctx.getCookie(OTP_CLAIM_COOKIE), expected);
    return unclaimed || (await otpSignInRefused(address));
  } catch (error) {
    // Fails open, the same direction as `mayMail` and for the same reason: this
    // is the only way in for everyone without ONID. What it opens: the plugin
    // still refuses a wrong code, and the admin plugin still refuses a banned
    // row a session, but nothing backs up the refusal of an unverified row
    // another provider is linked to. A redeem that lands during a failure here
    // verifies that row and leaves the other identity on it, which is the one
    // row answering to two people that `otp-sign-in-guard.ts` exists to stop.
    // It needs the database to fail these reads and not the plugin's own,
    // moments later, on the same request.
    console.error("Code sign-in guard failed", redactQueryError(error));
    return false;
  }
}

/**
 * Whether this is one of the three code paths with a body Better Auth is about
 * to reject in its own validation: a field its schema types that is missing or
 * not a string, or, on the send and the check, an address that fails Better
 * Auth's own lowercase then `z.email()`.
 *
 * The before-hook leaves such a body alone, spending nothing and guarding
 * nothing, so Better Auth answers with its own validation error, the same for
 * every address. Acting on one was three holes in the price ADR-0047 records;
 * docs/QUIRKS.md has them under "`hooks.before` sees a body Better Auth has not
 * validated yet". A `type` that is a string but not `"sign-in"` is not caught
 * here, whether or not Better Auth's enum knows it: `signInCodeAddress` turns
 * those away, as before.
 */
function isMalformedCodeRequest(ctx: CodeRequest): boolean {
  if (
    ctx.path !== CODE_SEND &&
    ctx.path !== CODE_CHECK &&
    ctx.path !== CODE_SIGN_IN
  ) {
    return false;
  }
  const email = ctx.body?.email;
  if (typeof email !== "string") {
    return true;
  }
  if (ctx.path !== CODE_SEND && typeof ctx.body?.otp !== "string") {
    return true;
  }
  if (ctx.path === CODE_SIGN_IN) {
    // The only other fields its schema types; anything else is an open record.
    return [ctx.body?.name, ctx.body?.image].some(
      (field) => field !== undefined && typeof field !== "string"
    );
  }
  return (
    typeof ctx.body?.type !== "string" ||
    !z.email().safeParse(email.toLowerCase()).success
  );
}

/**
 * The address this request is about, or null when it is not about a sign-in
 * code at all.
 *
 * One place rather than three, because the two guards and the cookie-issuing
 * after-hook all have to agree on what counts. They read the RAW body, before
 * Better Auth validates it, so a value that is not a string is somebody probing
 * rather than a person signing in.
 */
function signInCodeAddress(ctx: CodeRequest): string | null {
  const address = ctx.body?.email;
  if (typeof address !== "string") {
    return null;
  }
  // `/sign-in/email-otp` carries no `type`; the other two carry one and only
  // `"sign-in"` names the record this app serves.
  const type = ctx.body?.type;
  if (type !== undefined && type !== "sign-in") {
    return null;
  }
  return address;
}

/**
 * The token this request would need to claim the live code for an address, or
 * null when there is no live code to claim.
 */
async function expectedClaim(
  ctx: CodeRequest,
  email: string
): Promise<string | null> {
  const record = await ctx.context.internalAdapter.findVerificationValue(
    codeRecordFor(email)
  );
  if (!record || record.expiresAt < new Date()) {
    return null;
  }
  return await otpClaimToken(email, record.expiresAt, claimSecret);
}

/**
 * The endpoints this app does NOT serve.
 *
 * A plugin, and Better Auth's own core, mounts every endpoint it has whatever
 * the options say, so turning a feature off does not un-mount it: a direct POST
 * is still served, still counted by the rate limiter, and still reaches
 * whatever the handler does before it notices. Better Auth checks
 * `disabledPaths` in the router's `onRequest`, ahead of routing and ahead of the
 * rate limiter, so a listed path is a flat 404 rather than a handler that
 * declines.
 *
 * Two groups, and one path in each is the reason the group is here rather than
 * left to its handler.
 *
 * The password and its verification link (#576). With `emailAndPassword` off
 * the sign-in and sign-up handlers refuse on their own, but `/verify-email` does
 * not check it: it redeems any unexpired link Better Auth ever signed, and it
 * flips `emailVerified` WITHOUT calling `revokeUnprovenAccountAccess`, so a link
 * mailed in the hour before this shipped would verify a squatted row and leave
 * the squatter's session standing. The rest go because nothing here calls them
 * and "nothing calls it" is not "nothing reaches it". Production still holds
 * `credential` rows from before; these paths are what would have read them.
 * One cannot be listed: the match is an exact string against the request path,
 * so `GET /reset-password/:token` stays mounted. It changes no account: it looks
 * up a token no longer issued, which only sweeps expired `verification` rows the
 * way every lookup does, and redirects to a page that no longer exists. The
 * POST that would have set the password is listed.
 *
 * The email-otp paths outside the one flow this app runs. `emailOTP()` mounts
 * nine and three are served. `/email-otp/verify-email` has the same flaw as
 * `/verify-email` above, and `/sign-in/email-otp` is the only path that does
 * the revoke, so it is the only one that may verify. The password-reset and
 * email-change paths are surface with no caller.
 */
const DISABLED_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/verify-password",
  "/change-password",
  "/send-verification-email",
  "/verify-email",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];

/**
 * The ONID profile, with the one write that has to happen before Better Auth
 * decides whether to link (#554, piece B1).
 *
 * This is the first point in the callback where ownership of the address is
 * proved: the ID token is in hand, issued by the pinned tenant, for a person
 * the university has just interactively authenticated. `handleOAuthUserInfo`
 * runs straight afterwards and refuses to link into an unverified row, so
 * anything that wants to change that verdict has to run here.
 *
 * It does mean a mapper carries a write, which is worth naming rather than
 * hiding: `onid-profile.ts` stays pure and this wrapper owns the effect. The
 * alternative was a `hooks.after` on the callback plus
 * `accountLinking.requireLocalEmailVerified: false`, which cleans up after the
 * link instead of before it and relaxes a safe default for every provider
 * rather than for ONID alone.
 *
 * A failure here returns the profile unchanged rather than throwing. Falling
 * through leaves the student with `account not linked`, which is exactly
 * today's behaviour; throwing would turn a database blip into a broken ONID
 * callback for everybody.
 */
async function onidUserInfo(
  idToken: string | null | undefined
): Promise<OnidProfile | null> {
  const profile = onidProfileFromIdToken(idToken, authConfig.onid.issuer);
  if (!profile) {
    return null;
  }
  try {
    const released = await releaseUnverifiedAddress(
      profile.email,
      profile.name
    );
    if (released) {
      // Nothing else will. `user.create.after` only fires on creation, and
      // the link path's own `updateUser({ emailVerified: true })` is skipped
      // because the flag is already true by the time it looks.
      await claimProjectsFor(released.userId, profile.email);
    }
  } catch (error) {
    console.error(
      "Releasing an unverified address failed",
      redactQueryError(error)
    );
  }
  return profile;
}

/**
 * Whether one more code may go to this address right now (#554, piece D).
 *
 * Fails OPEN, which is the opposite of how a cap usually fails and is the right
 * direction here. What this gates is somebody's only way into their own
 * account, so a counter that cannot answer, a transient database blip, would
 * otherwise lock out everyone without ONID for the length of it; letting an
 * amplifier run for that window is the smaller harm. The code guard above fails
 * open for the same reason.
 */
async function mayMail(email: string): Promise<boolean> {
  try {
    return await reserveVerificationMail(email);
  } catch (error) {
    console.error("Verification mail counter failed", redactQueryError(error));
    return true;
  }
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  trustHost: authConfig.trustHost,
  // Numbers and reasons in lib/_internal/auth-rate-limits.ts. Still only
  // active under NODE_ENV=production, which is Better Auth's own default.
  rateLimit: authRateLimit,
  // The emailed code is the only credential this app checks itself (#576).
  // Better Auth's own limiter keys on the viewer address and nothing else, and
  // OSU wireless NATs students into a pool of shared addresses, so no
  // per-address number protects it (ADR-0039). What bounds guessing is the
  // per-recipient cap on sends, spent below, and the claim that ties a code to
  // the browser that asked for it (ADR-0047).
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (isMalformedCodeRequest(ctx)) {
        return;
      }
      // Asking for a code (#581). Two reasons to answer without letting Better
      // Auth touch the record, and both have to answer `{success: true}`
      // anyway, because the send endpoint must look the same whatever it
      // decides or it becomes an account enumerator.
      if (ctx.path === CODE_SEND) {
        if (!(await codeSendAllowed(ctx))) {
          throw new APIError("OK", { success: true });
        }
        return;
      }
      // Spending a guess, on either path that spends one. Both refusals wear
      // the shape of a wrong code: `otp-sign-in-guard.ts` says why the row
      // guard cannot say more, and the claim guard cannot either, because a
      // distinct refusal would tell a stranger whether a code is outstanding.
      const spendsAGuess = ctx.path === CODE_SIGN_IN || ctx.path === CODE_CHECK;
      if (spendsAGuess && (await codeGuessRefused(ctx))) {
        throw new APIError("BAD_REQUEST", {
          code: "INVALID_OTP",
          message: "Invalid OTP",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // The claim for the code that was just written (#581). Issued only where
      // the record was actually created, so a send that was refused above
      // hands out nothing: a browser that could get a claim without moving the
      // record could spend somebody else's guesses with it.
      if (ctx.path === CODE_SEND) {
        // Only a send that succeeded moved the record, so success is read
        // positively off the answer. A refused one still reaches this hook,
        // because an after-hook runs even when the handler throws, and the
        // record it would find is the owner's, unrotated.
        const address = signInCodeAddress(ctx);
        if (address === null || isMalformedCodeRequest(ctx)) {
          // The before-hook spent nothing on either, so there is nothing to
          // give back.
          return;
        }
        const sent =
          (ctx.context.returned as { success?: unknown } | null)?.success ===
          true;
        if (!sent) {
          // Refused inside the endpoint after the reservation, by a check of
          // Better Auth's own; see `refundVerificationMail`.
          try {
            await refundVerificationMail(address);
          } catch (error) {
            console.error(
              "Refunding a sign-in code send failed",
              redactQueryError(error)
            );
          }
          return;
        }
        try {
          const claim = await expectedClaim(ctx, address);
          if (claim) {
            ctx.setCookie(OTP_CLAIM_COOKIE, claim, {
              httpOnly: true,
              maxAge: CLAIM_COOKIE_SECONDS,
              path: "/",
              sameSite: "lax",
              secure: authConfig.isProduction,
            });
          }
        } catch (error) {
          // Swallowed rather than refused: the code is already mailed, and a
          // person holding one they cannot redeem is worse than one more
          // request. They can ask again, and that send will claim the record.
          console.error("Issuing a code claim failed", redactQueryError(error));
        }
        return;
      }
      // A redeemed code proves the address, which is the moment a project may
      // be linked to its proposer. A new row was claimed for at creation, so
      // this is for the row that already existed unverified, a password
      // account from before #576: Better Auth flips its flag in place, and
      // the only hook of ours that sees the write is the name check. Every
      // successful redeem runs this, because the session's user is read
      // before the flip and cannot say which rows were unverified; claiming
      // is idempotent and a verified row finds nothing.
      if (ctx.path === CODE_SIGN_IN) {
        const signedIn = ctx.context.newSession?.user;
        if (signedIn) {
          await claimProjectsFor(signedIn.id, signedIn.email);
        }
      }
    }),
  },
  // Better Auth catches an adapter failure and hands the error object to its
  // logger, whose default writes it through a console method. A Drizzle query
  // error carries the bound parameters, and the parameter of a session lookup
  // is the session token, so the default logger would put a live credential in
  // the log group. This redacts every argument rather than disabling the
  // logging, which would have swapped a leak for a blind spot.
  // `redact-query-error.ts` has the detail, including why logging
  // `error.message` alone is not the fix it looks like.
  logger: { log: redactingAuthLogger() },
  // Rethrow rather than let the router fall through to its own logging. Better
  // Auth's `onError` returns undefined on every branch, so `better-call`'s
  // router carries on to `console.error("# SERVER_ERROR: ", error)` with the
  // raw error (`better-call/dist/router.mjs`), which puts the parameters back
  // in the log group however careful the logger above is. Throwing instead
  // hands the error to `src/routes/api/auth/$.ts`, which logs it redacted and
  // answers 500. A redirect still short circuits first, and an APIError is
  // still turned into its response by the router's own catch, so this changes
  // nothing a client sees.
  onAPIError: { throw: true },
  // See DISABLED_PATHS: the retired password paths, and six of the nine
  // `emailOTP()` mounts, are 404 rather than served.
  disabledPaths: DISABLED_PATHS,
  advanced: {
    // CloudFront terminates TLS at the edge and forwards to the origin over
    // HTTP, so the app sees a plain-HTTP request. Pin secure cookies on in
    // production so a misread request protocol can't silently disable them.
    useSecureCookies: authConfig.isProduction,
    // The same proxy chain, seen from the rate limiter: without this, every
    // production request resolved to no address and shared one bucket per
    // path (#519). Rate limiting is off outside production, so nothing local
    // exercises it; src/lib/__tests__/trusted-proxies.test.ts pins the walk.
    // Also what `session.ipAddress` is resolved by.
    //
    // The value must stay non-empty whatever it holds, because the walk only
    // happens at all when the trusted list is non-empty. It does NOT name a
    // hop that gets skipped: `infra/ecs.tf` sets the load balancer to
    // `preserve`, so the chain reaching the task is CloudFront's own, whose
    // last entry is the viewer (#535). Explained once in the Better Auth
    // section of docs/QUIRKS.md.
    ipAddress: { trustedProxies: [...authConfig.trustedProxies] },
  },
  databaseHooks: {
    user: {
      create: {
        // The one place every provider creates through, which is why the name
        // rule sits here rather than once per sign-up path: email, GitHub and
        // ONID all land in this hook. `profileSchema` in `src/server/profile.ts`
        // states the same rule for the profile form, which does not come
        // through Better Auth at all.
        before: async (created) => ({
          data: { ...created, name: requireUserName(created.name) },
        }),
        // Every provider creates through here. A code sign-up arrives with
        // emailVerified set, because the row does not exist until the code is
        // redeemed. ONID sign-ups always arrive with it set, because the
        // university has already authenticated the person; see
        // lib/_internal/onid-profile.ts. GitHub sign-ups arrive with GitHub's
        // own verified flag for the chosen email (see
        // @better-auth/core/dist/social-providers/github.mjs getUserInfo), and
        // the guard is what keeps this from claiming for a GitHub address
        // GitHub has not verified.
        //
        // One other way in: the admin plugin's create-user takes an open data
        // record, so an admin can set emailVerified directly and claim for an
        // unproven address. Tolerated because admin is already privileged, but
        // it means this guard bounds the ordinary paths, not every path.
        after: async (created) => {
          if (created.emailVerified) {
            await claimProjectsFor(created.id, created.email);
          }
        },
      },
      update: {
        // `POST /update-user` types its `name` as `z.any()` and the admin
        // plugin's update takes an open record, so creation being narrowed
        // says nothing about either. Only when a name is actually being
        // written: most updates through here are a verification flag, a ban
        // or a role, and one that does not touch the column must pass through
        // rather than be judged on a field it is not writing.
        //
        // The test is `undefined`, not `"name" in updates`: the update route
        // builds its payload with every optional key present, so the `in`
        // check refused an update that carried an avatar and nothing else.
        before: async (updates) =>
          updates.name === undefined
            ? { data: updates }
            : { data: { ...updates, name: requireUserName(updates.name) } },
      },
    },
  },
  socialProviders: {
    github: authConfig.github,
  },
  account: {
    accountLinking: {
      // Redundant while onid-profile.ts asserts emailVerified unconditionally:
      // the guard in better-auth/dist/oauth2/link-account.mjs is
      // `!isTrustedProvider && !userInfo.emailVerified`, and the second half is
      // already false. It stays because it is the documented way to say "this
      // IdP is authoritative for its own domain", and because linking keeps
      // working if emailVerified ever becomes conditional on the claim.
      //
      // It deliberately does NOT relax requireLocalEmailVerified, which
      // defaults to true, because merging an authenticated ONID identity into
      // an address nobody has proven would let whoever set that password
      // inherit the real student's account.
      //
      // #554 does not contradict that, and the distinction is the whole of why
      // it is safe. The argument above refuses to LINK INTO an unverified row
      // and leave the password in place. `onidUserInfo` above does something
      // else: before the link is considered at all, it deletes the credential
      // and only then lets the row be linked, so there is no password left for
      // anyone to inherit. The guard here still stands for the case it was
      // written for, an unverified row that some OTHER provider is already
      // linked to, which `releaseUnverifiedAddress` refuses to touch.
      trustedProviders: ["onid"],
    },
  },
  user: {
    additionalFields: {
      affiliation: { type: "string", required: false },
      linkedin: { type: "string", required: false },
      wantsToMentor: { type: "boolean", required: false, defaultValue: false },
      mentorTeamCount: { type: "number", required: false, defaultValue: 1 },
      // Server-written only: `input: false` keeps it off every sign-up and
      // update body. Mirrors the column in auth-schema.ts. See #84.
      deletedAt: { type: "date", required: false, input: false },
    },
  },
  plugins: [
    // Both role names are held to `USER_ROLES` by `satisfies` rather than read
    // out of it. The plugin types these as `string` and `string | string[]`,
    // so a readonly tuple is not assignable and passing the vocabulary itself
    // would mean spreading it into a fresh array, which names no role in
    // particular and would hand admin powers to every role in the list. What
    // this buys is the failure that matters: a role renamed in the vocabulary
    // stops compiling here rather than silently un-admining every admin (#274).
    admin({
      adminRoles: ["admin" satisfies UserRole],
      defaultRole: "user" satisfies UserRole,
    }),
    // The emailed sign-in code (#576, ADR-0047). Six of the nine paths it
    // mounts are 404 through `disabledPaths` above; what is left is asking for
    // a code, checking one without spending it, and redeeming one.
    emailOTP({
      // Three per code, counted on the verification record, after which the
      // record is deleted. It is NOT the whole brute force story, because
      // `resendStrategy` defaults to `rotate` and a resend writes a fresh
      // record with the count back at zero. What bounds the resends is the
      // per-recipient cap, spent in the `hooks.before` on the send above.
      allowedAttempts: 3,
      // Open, deliberately. Industry partners and outside faculty have no ONID
      // and no office to route through, so closing this would leave them with
      // GitHub or nothing. `signInEmailOTP` writes `name: name || ""` on a
      // first sign-in and `requireUserName` throws BAD_REQUEST on a blank one,
      // which is why the sign-up route asks for a name and sends it: reaching
      // this path without one burns a code the person then cannot reuse.
      disableSignUp: false,
      // Encrypted rather than hashed, which is not the usual preference and is
      // right here. `storeOTP: "hashed"` is an unsalted SHA-256 over a six
      // digit space, so a leaked `verification` row is reversed by a table of a
      // million preimages; a hash is only a one-way function when the input
      // space is large. `encrypted` is `symmetricEncrypt` under the Better Auth
      // secret, which is not in the database, and unlike `hashed` it does not
      // disable `resendStrategy: "reuse"` should we ever want it.
      storeOTP: "encrypted",
      sendVerificationOTP: async ({ email, otp, type }) => {
        // Belt and braces with `disabledPaths`: the only reachable caller is
        // the sign-in send, and a code of any other type must never be mailed
        // even if a path is re-enabled without revisiting this.
        if (type !== "sign-in") {
          return;
        }
        try {
          // The per-recipient cap is NOT checked here. It is spent in the
          // `hooks.before` on this path, because `resolveOTP` has already
          // rotated the record by the time this runs, so refusing here would
          // leave the record holding a code nobody was told.
          await emailSender.send(email, signInCodeEmail({ otp }));
        } catch (error) {
          // Caught here so the line is ours and carries no address (#559), and
          // so the endpoint's answer does not depend on whether the send threw.
          // It must stay `{success: true}` either way: the response is the same
          // for an address with an account and one without, and that is what
          // keeps the send endpoint from answering "does this person exist".
          console.error(
            "Sending a sign-in code failed",
            redactQueryError(error)
          );
        }
      },
    }),
    // ONID, via the Oregon State Entra ID tenant. UIT registered the app as an
    // OIDC relying party rather than a SAML SP, which is why this is the
    // genericOAuth plugin and not @better-auth/sso.
    //
    // Two things about this config are worth not "fixing":
    //
    // The callback path is /api/auth/oauth2/callback/onid, which does not match
    // the /api/auth/callback/github shape beside it. That is the 1.6 generic
    // OAuth path, and Entra matches redirect URIs exactly against what UIT
    // allowlisted. better-auth 1.7 converges the two shapes, which is why
    // package.json pins ~1.6 rather than ^1.6.
    //
    // offline_access is absent on purpose. It buys a refresh token, and a
    // refresh token is only useful for calling an API as the user later. We
    // call nothing: the session is ours, not Microsoft's, so holding one would
    // be a stored credential with no purpose.
    genericOAuth({
      config: [
        {
          providerId: "onid",
          discoveryUrl: authConfig.onid.discoveryUrl,
          clientId: authConfig.onid.clientId,
          clientSecret: authConfig.onid.clientSecret,
          // `profile` is not decoration: Entra gates the `oid` claim behind it,
          // and `oid` is the account id. Dropping it forks every account onto
          // the `sub` fallback.
          scopes: ["openid", "profile", "email"],
          pkce: true,
          getUserInfo: (tokens) => onidUserInfo(tokens.idToken),
        },
      ],
    }),
    tanstackStartCookies(),
  ],
});
