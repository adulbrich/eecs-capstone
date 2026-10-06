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
    // No `issuer`: Better Auth 1.7 removed the option and takes the issuer
    // only from a discovery document, which this config does not have. What
    // went with it is the callback's comparison against an RFC 9207 `iss`
    // query parameter, which only ever ran if Entra sent one, and this
    // tenant's discovery document does not advertise that it does. The same
    // goes for 1.7's own id token verification, which also needs discovery
    // and so does not run here. What pins sign-in to the tenant is the `iss`
    // claim check in `onidUserInfo`, as it was before (#278).
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
    // The `account.accountId` every ONID row already holds, which is the
    // `oid` that `onidUserInfo` returns as `id`. Better Auth's default reads
    // `id` too, but only because this config has no discovery document: with
    // one it switches to `sub`, and every account would fork onto a new row
    // at its next sign-in. Stated here so adding `discoveryUrl` back cannot
    // change it.
    accountSubject: ({ profile }) => profile.id ?? "",
  };
}
