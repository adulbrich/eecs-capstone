import type { GenericOAuthConfig } from "better-auth/plugins";
import type { AuthConfig } from "./auth-config";

/**
 * The ONID entry for `genericOAuth`, built here rather than inline in
 * `src/lib/auth.ts` so a unit test can hand Better Auth's real handlers the
 * object production uses, without the database `auth.ts` imports.
 *
 * Not in `auth-config.ts`, because the traffic route reads that file and its
 * import graph is held free of Better Auth code, types included
 * (`src/server/__tests__/traffic-privacy.test.ts`).
 *
 * `getUserInfo` is the caller's because the production one can release an
 * unproven address through the database; the test passes a stub.
 */
export function onidProviderConfig(
  onid: AuthConfig["onid"],
  getUserInfo: NonNullable<GenericOAuthConfig["getUserInfo"]>
): GenericOAuthConfig {
  return {
    providerId: "onid",
    // Static, and no `discoveryUrl` beside them: with one set, Better Auth
    // fetches it in every sign-in and callback handler and overwrites both
    // of these with what it returns (#553).
    authorizationUrl: onid.authorizationUrl,
    tokenUrl: onid.tokenUrl,
    // The one other thing discovery supplied. The callback compares it with
    // the `iss` query parameter (RFC 9207) when Entra sends one, and takes it
    // from the discovery document when this is unset, so dropping discovery
    // without passing it would switch that check off without a word.
    issuer: onid.issuer,
    clientId: onid.clientId,
    clientSecret: onid.clientSecret,
    // `profile` is not decoration: Entra gates the `oid` claim behind it,
    // and `oid` is the account id. Dropping it forks every account onto
    // the `sub` fallback.
    scopes: ["openid", "profile", "email"],
    pkce: true,
    getUserInfo,
  };
}
