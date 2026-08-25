# ONID sign-in over OIDC

Date: 2026-08-24, revised 2026-08-25 after UIT answered the follow-up.
Status: Design settled, implemented on `feat/onid-oidc`. The live flow is
unverified and cannot be verified yet; see "What we cannot claim".

## Summary

UIT registered the app as an OpenID Connect relying party in the Oregon State
Entra ID tenant. That resolves the fork `docs/ONID-SSO.md` was written to
resolve: this is the `genericOAuth` branch, not the SAML branch, and the
`@better-auth/sso` package is not needed.

What they sent:

| Value | |
|---|---|
| Discovery URL | `https://login.microsoftonline.com/ce6d05e1-3c5e-4d62-87a8-4c4a2713c113/v2.0/.well-known/openid-configuration` |
| Tenant ID | `ce6d05e1-3c5e-4d62-87a8-4c4a2713c113` |
| Client ID | `d551d87a-b608-46a6-9fc3-a8b6bd56a5df` |
| Client secret | In `kv-engr-coe-vault-caps`, which we cannot currently read |
| Claims | `username`, `email`, `given_name`, `family_name`, in the ID token |
| Audience | Holders of an active College of Engineering account |

Three of their answers change the design rather than just filling in blanks.

1. **There is no ONID claim.** The nearest stable identifier is the UPN, carried
   in `username`, shaped `onid@oregonstate.edu`.
2. **The email claim is not guaranteed.** Entra does not promise `email` for
   every user, and Better Auth requires a unique, non-null email per user.
3. **No affiliation attributes.** Neither `eduPersonPrimaryAffiliation` nor
   `eduPersonScopedAffiliation` is released.

## What the discovery document adds

Fetched live rather than assumed. It is a stock Entra v2.0 tenant:

- `scopes_supported`: `openid`, `profile`, `email`, `offline_access`
- `userinfo_endpoint`: `https://graph.microsoft.com/oidc/userinfo`
- `claims_supported` lists `preferred_username`, and does **not** list `username`

That last line matters. Discovery metadata is tenant-wide and does not reflect
per-application claim policies, so `username` must come from an optional-claims
or claims-mapping configuration on this app registration specifically. We cannot
see it, and we cannot confirm it until an ID token is in hand.

The `userinfo_endpoint` matters more. It is Microsoft Graph, and Graph's OIDC
userinfo response carries a fixed set: `sub`, `name`, `given_name`,
`family_name`, `email`, `picture`. A tenant-custom `username` claim is **not**
in it. Whatever we read, we read from the ID token.

## Identity mapping

### The rule

```
issuer   = must equal the tenant issuer, or the token is refused outright
email    = email claim, then username, preferred_username, upn (all the UPN)
id       = oid, falling back to sub
name     = given_name + family_name, falling back to name, falling back to the local part of email
emailVerified = true, always
```

### Why `oid` rather than `sub`

Microsoft's claims reference says either works: "use `sub` or `oid` alone (which
as GUIDs are unique)". UIT recommended `oid` and they are right, for a reason the
reference states a paragraph earlier. `sub` is pairwise per application ID, so
recreating the app registration with a new client ID hands every existing user a
different `sub` and forks their account. `oid` is per user per tenant and
survives it. Over an application whose client secret expires in 2028 and whose
registration is administered by somebody else, that is not a hypothetical.

`sub` remains the fallback because Entra gates `oid` behind the `profile` scope.
We request it, but we do not control the registration, so losing `profile` should
degrade to `sub` rather than break sign-in outright.

### Why the issuer is pinned, and why we stayed single tenant

UIT offered to open the registration to all Entra tenants so that industry
partners could sign in. Declined, and the mapper now refuses any token whose
`iss` does not equal this tenant's issuer.

The vector is specific. Entra verifies the domain suffix of a UPN, so nobody can
mint `student@oregonstate.edu` as a UPN in their own tenant. It does not verify
the `mail` attribute behind the `email` claim, and the claims reference says
`email` "isn't guaranteed to be correct and is mutable over time. Never use it
for authorization or to save data for a user." Our mapper reads `email` first,
asserts `emailVerified: true`, and trusts `onid` for account linking. Multi-tenant
turns that composition into account takeover: register your own tenant, set a
user's mail attribute to a real student's address, sign in, get linked into their
account.

The expected issuer is derived from `ONID_DISCOVERY_URL`, which already carries
the tenant GUID, rather than added as a fourth environment variable that can fall
out of step. An empty discovery URL yields an empty issuer and the mapper refuses
everything, so an unconfigured deployment fails closed.

The check does not make the email trust self-sufficient. A guest invited into the
OSU tenant carries this tenant's `iss` with a home-tenant email and passes. What
makes the trust sound is the conjunction of the issuer pin and UIT publishing the
registration only to engineering-account holders. `idp` differing from `iss` is
the discriminator for a guest if that ever stops holding.

Partners do not need multi-tenant anyway: email and password with verification,
plus GitHub, is already the path for anyone without an ONID.

### Why the fallback is safe

The UPN is `onid@oregonstate.edu`. It is a real, deliverable address issued by
the same tenant that just authenticated the user, and Oregon State owns
`oregonstate.edu`. Synthesizing it is not inventing an address; it is reading the
one the IdP already asserted under a different name.

The chain tries three claim names because we have never seen a token from this
tenant. `username` is what UIT named, but it is not a stock Entra v2.0 claim;
`preferred_username` is what the tenant's discovery document advertises, and
`upn` is the optional-claim spelling. For a work or school account all three
carry the UPN, so trying each in turn costs one line and removes the likeliest
way this breaks on first contact. The personal-account caveat, that
`preferred_username` can be arbitrary, does not reach us: this registration is
published to engineering accounts in a single tenant.

What the chain cannot fix is the case where a student has a verified password
account at their ONID email address and then signs in with ONID without an
`email` claim. They get their UPN, a different address, and therefore a second
account rather than a link. At Oregon State the two usually match. This is
inherent to an IdP that does not guarantee the email claim, not something we can
fix on our side.

### Why `emailVerified` is unconditionally true

This is an assertion we are making, so it is worth stating plainly rather than
leaving it to be inferred from a boolean literal.

The tenant owns the domain, controls the mailbox, and has just completed an
interactive authentication including whatever MFA the university enforces. That
is a stronger proof of address control than the email-verification link the
password path sends. Treating it as unverified would be theatre.

It has two live consequences, both intended:

- **It fires the project-claim hook.** `databaseHooks.user.create.after` in
  `src/lib/auth.ts` claims a proposer's projects when `created.emailVerified` is
  true at creation. ONID users now hit that path, exactly as GitHub users with a
  GitHub-verified email already do. This is the "live back-fill hook" that
  `docs/QUIRKS.md` describes as built and waiting for the ONID provider.
- **It suppresses the verification email.** Better Auth sends one on OAuth
  sign-up when `emailVerified` is false and `emailVerification.sendOnSignUp` is
  true, which it is. A user the university just authenticated must not land in a
  verification loop, and setting the flag is what prevents it.

### Why the default `getUserInfo` is not enough

`node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs:406` reads:

```js
async function getUserInfo(tokens, finalUserInfoUrl) {
  if (tokens.idToken) {
    const decoded = decodeJwt(tokens.idToken);
    if (decoded) {
      if (decoded.sub && decoded.email) return { id: decoded.sub, ... };
    }
  }
  if (!finalUserInfoUrl) return null;
  // ... falls through to a Bearer GET against the userinfo endpoint
}
```

The ID-token branch requires **both** `sub` and `email`. The exact case UIT
warned us about, a user with no `email` claim, falls through to the Graph
userinfo endpoint, which does not carry `username` either. So the fallback the
whole design rests on would never fire, and the user would be rejected with
`email_is_missing`.

We therefore supply our own `getUserInfo`. It reads the ID token and nothing
else, which also removes an outbound call to Graph from the sign-in path.

### Why we do not verify the ID token signature

The token arrives in the response body of a back-channel POST that we make, to
an endpoint discovered over TLS from the tenant's own discovery document, and we
authenticate to it with the client secret. There is no attacker position between
the token endpoint and us that TLS does not already cover. This is the same
reasoning Better Auth's own default applies, and OpenID Connect Core 3.1.3.7
explicitly permits skipping signature validation when the token is obtained
directly from the token endpoint over a protected channel.

Consequently we decode rather than verify, and we do it with `Buffer.from(part,
"base64url")` instead of adding `jose` as a direct dependency. `jose` is present
today only as a transitive dependency of `better-auth`, and its `decodeJwt` does
not verify either, so importing it would buy nothing but a version coupling.

### Account linking

`account.accountLinking.trustedProviders` gains `onid`.

Read honestly, this line is **redundant today**. The guard in
`node_modules/better-auth/dist/oauth2/link-account.mjs:23` is
`!isTrustedProvider && !userInfo.emailVerified`, and we set `emailVerified`
unconditionally true, so the second half is already false. It is here because it
is the documented knob for "this IdP is authoritative for its domain," and
because it is what keeps linking working if `emailVerified` ever becomes
conditional on the claim being present. A future reader deleting it as dead
config would be right about today and wrong about the invariant.

What the line does **not** do is bypass `requireLocalEmailVerified`, which
defaults to true. A student who signed up with email and password and never
clicked the verification link will get `account not linked` on their first ONID
sign-in rather than a silent merge. That is the correct outcome: the local
account has not proven control of the address, and merging an authenticated ONID
identity into an unproven one would let a squatter who knows their own password
inherit a real student's account. We are not turning that off.

## Configuration

```ts
genericOAuth({
  config: [{
    providerId: "onid",
    discoveryUrl: process.env.ONID_DISCOVERY_URL ?? "",
    clientId: process.env.ONID_CLIENT_ID ?? "",
    clientSecret: process.env.ONID_CLIENT_SECRET ?? "",
    scopes: ["openid", "profile", "email"],
    pkce: true,
    getUserInfo: onidUserInfo,
  }],
})
```

`offline_access` is deliberately absent. It buys a refresh token, and a refresh
token is only useful for calling an API on the user's behalf later. We call
nothing; the session is ours, not Microsoft's, and holding a refresh token we
never redeem is a stored credential with no purpose.

`pkce: true` because Entra supports it, it costs one config line, and it closes
the authorization-code interception window.

The discovery URL is an env var rather than a literal so a future tenant change,
or a test tenant if UIT ever provides one, does not need a code change.

## Redirect URI

`better-auth` 1.6 mounts the generic OAuth callback at
`${baseURL}/oauth2/callback/${providerId}`, confirmed at
`node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs` in the
`signInWithOAuth2` handler. For this app that is:

- Production: `https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid`
- Local: `http://localhost:3000/api/auth/oauth2/callback/onid`

**`better-auth` moves to `~1.6.13` in this change.** The caret range was
tolerable while this was a paper design. It is not tolerable now. Version 1.7
rebuilds `genericOAuth` on the social-provider path, moves the callback to
`/api/auth/callback/:id`, and removes `genericOAuthClient()` entirely. Since
Entra matches redirect URIs exactly, a routine `npm update` would break ONID
sign-in with no code change and no failing test. Upgrading to 1.7 is now a
change that requires a new URI allowlisted by UIT first.

## User interface

`signIn.oauth2` does not exist on the base client, so `src/lib/auth-client.ts`
gains `genericOAuthClient()`. The server config alone looks complete and does
nothing.

Both `sign-in.tsx` and `sign-up.tsx` carry a GitHub button. ONID goes above it
on both, as the default variant against GitHub's outline, because the ticket
framed ONID as the primary path and Oregon State users should not have to hunt.

The sign-in search schema gains `error`. Better Auth redirects failures to
`errorCallbackURL` with an `error` query parameter, and `account not linked` is
a realistic first-sign-in outcome for a student with an unverified password
account. Today that redirect lands on Better Auth's bare `/api/auth/error` page,
which tells the user nothing and offers no way back. Pointing it at `/sign-in`
and rendering a mapped message costs a few lines and turns a dead end into an
instruction.

## Environment and infrastructure

`.env.example` gains `ONID_DISCOVERY_URL`, `ONID_CLIENT_ID` and
`ONID_CLIENT_SECRET`, alongside the GitHub pair.

`infra/secrets.tf` gains an `onid_client_secret` secret following the
`github_client_secret` pattern exactly: a placeholder value plus
`ignore_changes = [secret_string]`, so the real value is set once by hand after
apply and Terraform never reverts it. `infra/ecs.tf` carries the client ID and
discovery URL as plain task-definition environment variables and the secret as a
`secrets` entry.

Note that this secret crosses clouds. It lives in Azure Key Vault because that is
where Entra put it, and it has to be copied by hand into AWS Secrets Manager.
There is no sync, and there should not be one for a value that changes every two
years.

## Testing

`onidUserInfo` is a pure function of an ID token, which is the whole reason it is
factored out of the config object. `src/lib/__tests__/onid-profile.test.ts`
covers it directly with hand-built unsigned tokens:

- Both claims present: `email` wins.
- `email` absent: falls back to the UPN in `username`.
- `email` absent and only `preferred_username` or `upn` present: each is
  accepted in turn, and `username` wins when more than one is present.
- All of them absent: returns `null`, which Better Auth turns into
  `user_info_is_missing` rather than creating a broken account.
- Name assembled from `given_name` and `family_name`; falls back to `name`, then
  to the local part of the email.
- `emailVerified` is true even when the IdP says `email_verified: false`, with
  the test naming that as the deliberate override it is.
- Malformed input: not a JWT, non-base64 payload, payload that is not an object.

The a11y suite covers `/sign-in` and `/sign-up`, so both grow a button that axe
will check.

## What we cannot claim

As of 2026-08-25 one blocker remains: the client secrets are in a Key Vault we
still cannot read. UIT report the Secrets User role was assigned at vault
creation and suspect a tenant misconfiguration. Both redirect URIs are now
registered and a development secret exists. Until the vault opens, **no part of
the live flow has been exercised**: not the authorization redirect, not the token
exchange, not the claim shape.

Specifically, the UPN claim name is an unverified assumption. `username` is not
a stock Entra claim: UIT took it from a Proxmox realm configuration and agree it
is non-standard, and no ID token has been decoded.
The mapper accepts `username`, `preferred_username` and `upn` rather than betting
on one, which should make this a non-event; what it cannot cover is a fourth
name nobody has guessed. The unit tests prove the mapping logic is correct given
the claim names; they cannot prove the claim names.

The first real sign-in is the test that matters, and it has not been run.

## Deliberately not built

- **No affiliation mapping.** `docs/ONID-SSO.md` proposed mapping
  `eduPersonPrimaryAffiliation` onto `user.additionalFields.affiliation`. UIT
  does not release it. The column stays a user-entered mentor-profile field
  (`src/server/profile.ts`, required when `wantsToMentor`) and ONID does not
  touch it.
- **No ONID username column.** Storing the UPN separately from email is a
  migration for a value we would not read. When something needs to display or
  join on an ONID, add it then.
- **No single logout.** Not requested by UIT, and signing out of the app should
  not sign a user out of every Microsoft property in the tenant.
- **No email/password removal.** Industry partners and outside faculty have no
  ONID, and question 6 to UIT may narrow the ONID audience further to College of
  Engineering account holders only. All three paths stay.
