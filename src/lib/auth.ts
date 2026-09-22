import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getIp,
  isAPIError,
} from "better-auth/api";
import { admin, emailOTP, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
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
import { buildNotificationConfig } from "#/lib/email/config";
import { getEmailSender } from "#/lib/email/sender";
import {
  addressAlreadyRegisteredEmail,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
} from "#/lib/email/templates";
import { tooManyAttemptsMessage } from "#/lib/sign-in-limits";
import type { VerificationMailKind } from "#/lib/verification-mail-limits";
import type { UserRole } from "#/lib/vocabularies";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";
import { markAddressProven } from "#/server/_internal/mark-address-proven";
import { otpSignInRefused } from "#/server/_internal/otp-sign-in-guard";
import { releaseUnverifiedAddress } from "#/server/_internal/release-unverified-address";
import {
  attemptKey,
  checkSignInAllowed,
  clearSignInAttempts,
  recordFailedSignIn,
} from "#/server/_internal/sign-in-attempts";
import { reserveVerificationMail } from "#/server/_internal/verification-sends";

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
 * `create.after` hooks in a loop with no try/catch of its own, and awaits
 * `afterEmailVerification` unguarded, so an exception escaping here would break
 * account creation and email verification respectively. Claiming is also
 * idempotent, so the next verification or sign-in retries it for free.
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

/** Where a mailed verification link lands once its token checks out. */
const VERIFICATION_LANDING = "/verify-email";

/**
 * Rewrites the `callbackURL` Better Auth put in a verification link.
 *
 * It builds `url` from the body of whichever call mailed the link, defaulting
 * to "/", so the obvious place to ask for `/verify-email` is the two callers,
 * and that is where it used to be. It cannot go there: `signIn.email` returns
 * `redirect: true` with the same `callbackURL` on a SUCCESSFUL sign-in, and
 * the client's redirect plugin turns that into a `window.location.href`, which
 * raced sign-in.tsx's own `navigate` and could strand a verified person on
 * /verify-email or drop their `?redirect=` return path (#254). Setting it here
 * keeps the link right without the request body deciding where a sign-in goes.
 *
 * The cost of the hook being the last word is that it is the last word for
 * every flow that mails a verification link. `user.changeEmail` is not
 * configured, so today that is sign-up and the refused sign-in only; enabling
 * it would want this to ask which flow it is serving before overwriting.
 */
function withVerificationLanding(url: string): string {
  const link = new URL(url);
  link.searchParams.set("callbackURL", VERIFICATION_LANDING);
  return link.toString();
}

/** The one path the attempt counter guards. ONID and GitHub are authenticated
 * elsewhere, so there is no credential here to protect on those. */
const PASSWORD_SIGN_IN = "/sign-in/email";

/** Where an emailed code is redeemed (#576). Guarded below, for the two rows
 * Better Auth's own helper does not refuse; see `otp-sign-in-guard.ts`. */
const CODE_SIGN_IN = "/sign-in/email-otp";

/**
 * The email-otp endpoints this app does NOT serve.
 *
 * `emailOTP()` mounts nine paths whatever its options say, and only three of
 * them belong to the flow this app runs. Better Auth checks `disabledPaths` in
 * the router's `onRequest`, ahead of routing and ahead of the rate limiter, so
 * a listed path is a flat 404 rather than a handler that declines.
 *
 * `/email-otp/verify-email` is the one that has to go. It flips `emailVerified`
 * on an address that presents a valid code WITHOUT calling
 * `revokeUnprovenAccountAccess` first, which is #575's attack through a new
 * door: while password sign-up still exists, a squatter registers an address,
 * the real owner asks for a code and redeems it there, and the owner has now
 * verified a row whose password the squatter chose. `/sign-in/email-otp` is the
 * only path that does the revoke, so it is the only one that may verify.
 *
 * The password-reset and email-change paths are disabled for a duller reason:
 * this app has its own flows for both, and a second set of endpoints reaching
 * the same columns is surface with no caller.
 */
const DISABLED_OTP_PATHS = [
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];

/**
 * How a viewer address is resolved, in one object because two callers have to
 * agree on it: Better Auth's own rate limiter, through the `advanced` block
 * below, and `viewerAddress` for the sign-in counter. Written twice it would
 * drift the day either one gains a field.
 */
const ipAddressOptions = { trustedProxies: [...authConfig.trustedProxies] };

/**
 * The viewer, resolved by the same function Better Auth's own limiter uses.
 *
 * This used to hand-roll the walk, on a note claiming `getIp` was not exported
 * from a stable path. That was wrong: it comes from `better-auth/api` alongside
 * `APIError`. The reimplementation compared entries against `trustedProxies`
 * with string equality, so `10.0.0.0/16` matched no address and it always took
 * the rightmost entry. That happens to be the viewer under `preserve`, so it
 * was right by accident rather than by the logic, and it had quietly dropped
 * CIDR matching, address validation, and the IPv6 /64 normalisation that keeps
 * one person on one key.
 */
function viewerAddress(headers: Headers | undefined): string | null {
  if (!headers) {
    return null;
  }
  return getIp(new Request("http://localhost", { headers }), {
    advanced: { ipAddress: ipAddressOptions },
  });
}

/**
 * A sign-in that actually produced a session.
 *
 * Positive detection on purpose, and the reason is the bypass this replaces.
 * There are TWO `APIError` classes in play: the one `better-auth/api` exports,
 * which the sign-in endpoint throws, and better-call's own, thrown when a
 * request body fails its schema. So `returned instanceof APIError` is FALSE for
 * a malformed body, and reading that as "not an error, therefore a success"
 * meant four wrong passwords followed by one request with `password` omitted
 * cleared the counter, forever. The absence of an error is not a success.
 * docs/QUIRKS.md carries this under the Better Auth section.
 */
function isSuccessfulSignIn(returned: unknown): boolean {
  return (
    !isAPIError(returned) &&
    typeof returned === "object" &&
    returned !== null &&
    "user" in returned
  );
}

/**
 * The one outcome that means somebody offered a credential and it was wrong.
 *
 * Narrow on purpose. Counting every error would count `EMAIL_NOT_VERIFIED`,
 * which is what a person with the RIGHT password gets when their address is
 * unverified, and that refusal is also what mails them a fresh verification
 * link. Throttling it would lock them out of their own only way back in.
 */
function isWrongCredential(returned: unknown): boolean {
  return (
    isAPIError(returned) &&
    (returned as { body?: { code?: string } }).body?.code ===
      "INVALID_EMAIL_OR_PASSWORD"
  );
}

/**
 * Swallows a counter failure rather than refusing the sign-in.
 *
 * Deliberate, and the opposite of how the rest of this file fails. If the
 * database is unreachable the counter cannot answer, and the choice is between
 * letting sign-ins through unguarded and refusing everyone. Better Auth's own
 * per-address limit still applies either way, and a brute force window during a
 * database outage is a smaller problem than an auth outage on top of it. The
 * error is logged so the gap is visible rather than silent.
 */
async function swallowing(what: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    console.error(
      `Sign-in attempt counter failed (${what})`,
      redactQueryError(error)
    );
  }
}

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
      // Nothing else will. `afterEmailVerification` is not on this path,
      // `user.create.after` only fires on creation, and the link path's own
      // `updateUser({ emailVerified: true })` is skipped because the flag is
      // already true by the time it looks.
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
 * Where the B2 message sends somebody to take their address back.
 *
 * A link to the page, carrying no token. A token for the squatted row would
 * verify THAT row, which is the trap #554's comment identifies: the real owner
 * clicks it, the attacker's account becomes confirmed, and
 * `autoSignInAfterVerification` signs the owner into an account whose password
 * a stranger chose. Sending them to request their own reset costs one extra
 * click and inverts that: the token they end up consuming is one they asked
 * for, and setting a password evicts the squatter's.
 *
 * Built from `BETTER_AUTH_URL` rather than `SITE_ORIGIN`, which is a `VITE_`
 * value inlined at build time for tags that need an absolute URL on the client.
 * This runs on the server only, and every other server-sent link in the app is
 * built from the same config (`lib/email/config.ts`). Null when it is unset,
 * and the caller then sends nothing: a message whose one instruction is a link
 * to `null/forgot-password` is worse than silence.
 */
function forgotPasswordUrl(): string | null {
  const base = buildNotificationConfig().appBaseUrl;
  return base ? `${base}/forgot-password` : null;
}

/**
 * Whether one more message may go to this address right now (#554, piece D).
 *
 * Fails OPEN, which is the opposite of how a cap usually fails and is the right
 * direction here. Everything this gates is somebody's only way into their own
 * account, and by the time either caller runs, Better Auth has already read the
 * user out of the database, so a counter that cannot answer means a transient
 * blip rather than a database that is down. Refusing mail through one would
 * lock out every new account for the length of it; letting an amplifier run for
 * that window is the smaller harm. Same reasoning as `swallowing` above.
 */
async function mayMail(
  email: string,
  kind: VerificationMailKind
): Promise<boolean> {
  try {
    return await reserveVerificationMail(email, kind);
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
  // Per-account brute force protection (#552). Better Auth's own limiter keys
  // on the viewer address and nothing else, and OSU wireless NATs students into
  // a pool of shared addresses, so no per-address number protects a credential
  // here (ADR-0039). This counts failures per (account, address) pair instead:
  // per account because that is the thing being attacked, and paired with the
  // address so nobody can lock a stranger out of their own account by guessing
  // it a few times.
  //
  // It deliberately does NOT raise the Better Auth limit on /sign-in/email.
  // That number used to do double duty as a cap on verification mail aimed at
  // an address the sender does not own; #554 moved that job to a per-recipient
  // cap on the send itself, so the path is now free to be raised on its own
  // merits, which is #552's call and not this counter's. Adding this counter
  // is purely additive.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Two rows Better Auth's own `revokeUnprovenAccountAccess` will not
      // refuse, and `releaseUnverifiedAddress` does. The refusal deliberately
      // wears the shape of a wrong code; `otp-sign-in-guard.ts` has both the
      // attacks and the reason it cannot say more.
      if (ctx.path === CODE_SIGN_IN) {
        const address = ctx.body?.email;
        if (typeof address !== "string") {
          return;
        }
        let refused: boolean;
        try {
          refused = await otpSignInRefused(address);
        } catch (error) {
          // Fails open, the same direction as `swallowing` and for the same
          // reason: a database blip must not become an auth outage. What it
          // opens is narrow, because the plugin still refuses a wrong code and
          // the admin plugin still refuses a banned row a session.
          console.error("Code sign-in guard failed", redactQueryError(error));
          return;
        }
        if (refused) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_OTP",
            message: "Invalid OTP",
          });
        }
        return;
      }
      if (ctx.path !== PASSWORD_SIGN_IN) {
        return;
      }
      const { email, ip } = attemptKey(
        ctx.body?.email,
        viewerAddress(ctx.headers)
      );
      if (!email) {
        return;
      }
      // Refuses before the password is checked, which also means a locked pair
      // costs no scrypt. If the counter itself fails, `checkSignInAllowed`
      // throws and this hook lets it through rather than refusing the person;
      // see `swallowing` for why that direction.
      let verdict: Awaited<ReturnType<typeof checkSignInAllowed>>;
      try {
        verdict = await checkSignInAllowed(email, ip);
      } catch (error) {
        console.error(
          "Sign-in attempt counter failed (check)",
          redactQueryError(error)
        );
        return;
      }
      if (!verdict.allowed) {
        throw new APIError("TOO_MANY_REQUESTS", {
          code: "TOO_MANY_SIGN_IN_ATTEMPTS",
          message: tooManyAttemptsMessage(verdict.retryAfterSeconds),
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== PASSWORD_SIGN_IN) {
        return;
      }
      const { email, ip } = attemptKey(
        ctx.body?.email,
        viewerAddress(ctx.headers)
      );
      if (!email) {
        return;
      }
      // Success is detected positively and a failure narrowly; see
      // `isSuccessfulSignIn` for the bypass that shape exists to prevent.
      // Anything that is neither, a malformed body or an unverified address,
      // leaves the count untouched.
      const returned = ctx.context.returned;
      if (isSuccessfulSignIn(returned)) {
        await swallowing("clear", () => clearSignInAttempts(email, ip));
        return;
      }
      if (isWrongCredential(returned)) {
        await swallowing("record", () => recordFailedSignIn(email, ip));
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
  // See DISABLED_OTP_PATHS. Six of the nine paths `emailOTP()` mounts are 404
  // rather than served, one of them because serving it would reopen #575.
  disabledPaths: DISABLED_OTP_PATHS,
  advanced: {
    // CloudFront terminates TLS at the edge and forwards to the origin over
    // HTTP, so the app sees a plain-HTTP request. Pin secure cookies on in
    // production so a misread request protocol can't silently disable them.
    useSecureCookies: authConfig.isProduction,
    // The same proxy chain, seen from the rate limiter: without this, every
    // production request resolved to no address and shared one bucket per
    // path (#519). Rate limiting is off outside production, so nothing local
    // exercises it; src/lib/__tests__/trusted-proxies.test.ts pins the walk.
    //
    // The value must stay non-empty whatever it holds, because the walk only
    // happens at all when the trusted list is non-empty. It does NOT name a
    // hop that gets skipped: `infra/ecs.tf` sets the load balancer to
    // `preserve`, so the chain reaching the task is CloudFront's own, whose
    // last entry is the viewer (#535). Explained once in the Better Auth
    // section of docs/QUIRKS.md.
    ipAddress: ipAddressOptions,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await emailSender.send(user.email, passwordResetEmail({ url }));
    },
    // #554, piece B2. Fires in Better Auth's duplicate branch with the EXISTING
    // row, and only because `requireEmailVerification` is true. It is the one
    // place the real owner of a squatted address can be told anything at all:
    // the HTTP response is a synthetic success, by design, so the person who
    // actually owns the address otherwise sees "account created", receives
    // nothing, and is refused at sign-in with no explanation. This changes no
    // response and so gives up none of that enumeration protection; only
    // whoever holds the inbox learns anything.
    //
    // Unverified only. A confirmed account belongs to somebody, and telling
    // them about every stranger who typed their address is noise, not news.
    onExistingUserSignUp: async ({ user: existing }) => {
      if (existing.emailVerified) {
        return;
      }
      try {
        const recovery = forgotPasswordUrl();
        if (!(recovery && (await mayMail(existing.email, "duplicate")))) {
          return;
        }
        await emailSender.send(
          existing.email,
          addressAlreadyRegisteredEmail({ url: recovery })
        );
      } catch (error) {
        // Better Auth awaits this through `runInBackgroundOrAwait`, which
        // catches and logs through its own logger. Caught here anyway so the
        // line is ours and carries no address (#559), and so a sign-up never
        // depends on that internal staying the way it is.
        console.error(
          "Notifying an existing unverified account failed",
          redactQueryError(error)
        );
      }
    },
    // A completed reset proves the person holds the inbox, which Better Auth
    // does not record. See `mark-address-proven.ts` for why that proof is as
    // good as a verification link, and why leaving it unrecorded would let the
    // cap in piece D refuse a squatted student the one message they need.
    onPasswordReset: async ({ user: reset }) => {
      try {
        const proven = await markAddressProven(reset.id);
        if (proven) {
          await claimProjectsFor(reset.id, proven.email);
        }
      } catch (error) {
        console.error(
          "Marking an address proven after a reset failed",
          redactQueryError(error)
        );
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // A refused sign-in on an unverified account mails a fresh link, which is
    // the only way out for a person whose first link expired or went missing:
    // sign-in refuses them and nothing else in the app sends one. Better Auth
    // runs this after the password check, so a wrong password costs no mail.
    //
    // A wrong password is the only thing that costs no mail, though. Sign-up is
    // open, so anyone can register an address they do NOT own with a password
    // they choose, and then every sign-in mails the real owner a fresh link.
    // The rate limit on /sign-in/email used to be the only ceiling on that,
    // which is why #535 left that one path on Better Auth's 3-per-10-seconds
    // default while raising every other path around it. #554 metered the send
    // instead, below, so that path's number is no longer doing double duty and
    // #552 may now raise it on its own merits. Raising it is not this change's
    // to make, and ADR-0039 is where the argument for the number lives.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // The cap (#554, piece D). Metering the SEND rather than the route is the
      // whole point: the route is `/sign-in/email`, whose limit keys on the
      // sender's address, and neither the sender's address nor its rate says
      // anything about whose inbox is filling up. A refusal here is a silent
      // skip and never an error, because the caller is a sign-up or a refused
      // sign-in and neither should fail over a message that was not sent.
      if (!(await mayMail(user.email, "verification"))) {
        // No address in the line; `sign_in_attempts`'s sibling table holds the
        // identifiers for anyone with database access (#559).
        console.warn("Verification mail capped for a recipient");
        return;
      }
      await emailSender.send(
        user.email,
        verificationEmail({ url: withVerificationLanding(url) })
      );
    },
    // The address is proven at exactly this moment, so this is where a project
    // may be linked to its proposer.
    afterEmailVerification: async (verified) => {
      await claimProjectsFor(verified.id, verified.email);
    },
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
        // Covers OAuth, which never visits the email-verification routes and so
        // never fires afterEmailVerification. The guard is what keeps this from
        // claiming for an unverified password sign-up, where emailVerified is
        // false at creation. GitHub sign-ups arrive here with emailVerified set
        // to GitHub's own verified flag for the chosen email (see
        // @better-auth/core/dist/social-providers/github.mjs getUserInfo), so a
        // GitHub account with a GitHub-verified email is claimed at creation.
        // ONID sign-ups always arrive with it set, because the university has
        // already authenticated the person; see lib/_internal/onid-profile.ts.
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
      // per-recipient cap in `sendVerificationOTP` below.
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
          if (!(await mayMail(email, "sign-in-code"))) {
            return;
          }
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
