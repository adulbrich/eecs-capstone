import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import { getEmailSender } from "#/lib/email/sender";
import { passwordResetEmail, verificationEmail } from "#/lib/email/templates";
import { claimProjectsForVerifiedUser } from "#/server/_internal/claim-projects";

const emailSender = getEmailSender();

const isProduction = process.env.NODE_ENV === "production";

/**
 * Claims a newly verified user's projects. Swallows failure on purpose: a
 * claim must never block a sign-in or a verification, and the operation is
 * idempotent, so the next verification or sign-in retries it for free.
 */
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

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  trustHost: process.env.NODE_ENV !== "development",
  // CloudFront terminates TLS at the edge and forwards to the origin over
  // HTTP, so the app sees a plain-HTTP request. Pin secure cookies on in
  // production so a misread request protocol can't silently disable them.
  advanced: { useSecureCookies: isProduction },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await emailSender.send(user.email, passwordResetEmail({ url }));
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    callbackURL: "/verify-email",
    sendVerificationEmail: async ({ user, url }) => {
      await emailSender.send(user.email, verificationEmail({ url }));
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
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },
  user: {
    additionalFields: {
      affiliation: { type: "string", required: false },
      linkedin: { type: "string", required: false },
      wantsToMentor: { type: "boolean", required: false, defaultValue: false },
      mentorTeamCount: { type: "number", required: false, defaultValue: 1 },
    },
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    tanstackStartCookies(),
  ],
});
