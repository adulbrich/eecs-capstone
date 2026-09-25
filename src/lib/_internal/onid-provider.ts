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
    // Static, with no `discoveryUrl` beside them; see
    // `endpointsFromDiscoveryUrl` for why (#553).
    authorizationUrl: onid.authorizationUrl,
    tokenUrl: onid.tokenUrl,
    // The one other value discovery supplied that this config still needs
    // (its userinfo endpoint goes unused, since `getUserInfo` is ours). The
    // callback compares it with an RFC 9207 `iss` query parameter, but only if
    // Entra sends one, and this tenant's discovery document does not advertise
    // that it does. So this is a conditional safeguard, kept so the check
    // still runs if Entra ever starts sending `iss`. What pins sign-in to the
    // tenant is the `iss` claim check in `onidUserInfo`.
    issuer: onid.issuer,
    clientId: onid.clientId,
    clientSecret: onid.clientSecret,
    // `profile` is not decoration: Entra gates the `oid` claim behind it,
    // and `oid` is the account id. Dropping it forks every account onto
    // the `sub` fallback.
    //
    // `offline_access` is absent on purpose. It buys a refresh token, and a
    // refresh token is only useful for calling an API as the user later. We
    // call nothing: the session is ours, not Microsoft's, so holding one
    // would be a stored credential with no purpose.
    scopes: ["openid", "profile", "email"],
    pkce: true,
    getUserInfo,
  };
}
