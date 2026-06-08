import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import { getEmailSender } from "#/lib/email/sender";

const emailSender = getEmailSender();

const isProduction = process.env.NODE_ENV === "production";

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
      await emailSender.sendPasswordReset({ to: user.email, url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    callbackURL: "/verify-email",
    sendVerificationEmail: async ({ user, url }) => {
      await emailSender.sendVerification({ to: user.email, url });
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
    },
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    tanstackStartCookies(),
  ],
});
