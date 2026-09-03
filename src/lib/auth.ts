import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import {
  buildAuthConfig,
  warnUnconfiguredProviders,
} from "#/lib/_internal/auth-config";
import { onidProfileFromIdToken } from "#/lib/_internal/onid-profile";
import { getEmailSender } from "#/lib/email/sender";
import { passwordResetEmail, verificationEmail } from "#/lib/email/templates";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";

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

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  trustHost: authConfig.trustHost,
  // CloudFront terminates TLS at the edge and forwards to the origin over
  // HTTP, so the app sees a plain-HTTP request. Pin secure cookies on in
  // production so a misread request protocol can't silently disable them.
  advanced: { useSecureCookies: authConfig.isProduction },
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
    // runs this after the password check, so a wrong password costs no mail,
    // and its rate limiter covers the route.
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
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
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
