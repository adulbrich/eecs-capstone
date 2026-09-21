import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getIp,
  isAPIError,
} from "better-auth/api";
import { admin, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import {
  buildAuthConfig,
  warnUnconfiguredProviders,
} from "#/lib/_internal/auth-config";
import { authRateLimit } from "#/lib/_internal/auth-rate-limits";
import { onidProfileFromIdToken } from "#/lib/_internal/onid-profile";
import { requireUserName } from "#/lib/_internal/user-name";
import { getEmailSender } from "#/lib/email/sender";
import { passwordResetEmail, verificationEmail } from "#/lib/email/templates";
import { tooManyAttemptsMessage } from "#/lib/sign-in-limits";
import type { UserRole } from "#/lib/vocabularies";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";
import {
  attemptKey,
  checkSignInAllowed,
  clearSignInAttempts,
  recordFailedSignIn,
} from "#/server/_internal/sign-in-attempts";

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
    console.error(`Claiming projects failed for user ${userId}`, error);
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
    advanced: { ipAddress: { trustedProxies: [...authConfig.trustedProxies] } },
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
    console.error(`Sign-in attempt counter failed (${what})`, error);
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
  // That number is currently doing double duty as a cap on verification mail
  // aimed at an address the sender does not own, and raising it before #554
  // meters the send would reopen that. Adding this counter is purely additive.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
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
        console.error("Sign-in attempt counter failed (check)", error);
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
    ipAddress: { trustedProxies: [...authConfig.trustedProxies] },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await emailSender.send(user.email, passwordResetEmail({ url }));
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
    // The rate limit on /sign-in/email is therefore also the ceiling on
    // verification mail aimed at a stranger, which is why #535 left that one
    // path on Better Auth's 3-per-10-seconds default while raising every other
    // path around it. #554 is the fix, and it is to meter the send rather than
    // the route; until it lands, do not raise /sign-in/email.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
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
      // defaults to true. A student who signed up with a password and never
      // clicked the verification link gets `account not linked` on their first
      // ONID sign-in rather than a silent merge, because merging an
      // authenticated ONID identity into an address nobody has proven would let
      // whoever set that password inherit the real student's account.
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
          getUserInfo: (tokens) =>
            Promise.resolve(
              onidProfileFromIdToken(tokens.idToken, authConfig.onid.issuer)
            ),
        },
      ],
    }),
    tanstackStartCookies(),
  ],
});
