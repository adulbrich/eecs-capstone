# ONID sign-in

How ONID sign-in works, how to operate it, and what is still open with UIT.

UIT registered the app as an OpenID Connect relying party in the Oregon State
Entra ID tenant on 2026-08-24. That settled the question this document used to
be written around: this is OIDC, not SAML, so it is Better Auth's `genericOAuth`
plugin and not the `@better-auth/sso` package. The design reasoning lives in
`docs/superpowers/specs/2026-08-24-onid-oidc-design.md`.

## Registration

| | |
|---|---|
| Tenant ID | `ce6d05e1-3c5e-4d62-87a8-4c4a2713c113` |
| Client ID | `d551d87a-b608-46a6-9fc3-a8b6bd56a5df` |
| Discovery URL | `https://login.microsoftonline.com/ce6d05e1-3c5e-4d62-87a8-4c4a2713c113/v2.0/.well-known/openid-configuration` |
| Client secret | Azure Key Vault `kv-engr-coe-vault-caps` |
| Scopes requested | `openid profile email` |
| Claims released | `username`, `email`, `given_name`, `family_name` |
| Audience | Holders of an active College of Engineering account |

The client ID, tenant ID and discovery URL are public values. They appear in
`.env.example` and `infra/variables.tf` on purpose; treating them as secrets
buys nothing and costs every new developer a round trip.

## Redirect URIs

```
https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid
http://localhost:3000/api/auth/oauth2/callback/onid
```

Note the `oauth2` segment. It does not match GitHub's
`/api/auth/callback/github` sitting beside it in the same app, and that is not a
mistake to tidy up: it is where Better Auth 1.6 mounts the generic OAuth
callback (`signInWithOAuth2` in
`better-auth/dist/plugins/generic-oauth/routes.mjs`).

Entra matches redirect URIs exactly. A URI that is not allowlisted fails at
sign-in, not at configuration time, which is why `package.json` pins
`better-auth` to `~1.6.13` rather than `^1.6.13`. Version 1.7 rebuilds
`genericOAuth` on the social-provider path, moves the callback to
`/api/auth/callback/:id`, and removes `genericOAuthClient()`. Under a caret
range, a routine `npm update` would break ONID sign-in with no code change and
no failing test. **Upgrading to 1.7 requires UIT to allowlist the new URI
first.**

## How identity maps

Everything is read from the ID token by
`src/lib/_internal/onid-profile.ts`, which the `genericOAuth` config calls
through `getUserInfo`.

```
id            = sub
email         = email, then username, preferred_username, upn (all the UPN)
name          = given_name + family_name, then name, then the local part of email
emailVerified = true, always
```

Three things about this are worth knowing before you change any of it.

**There is no ONID claim.** UIT: "To my knowledge the ONID is not available via
OIDC. The next-best record would be the UPN, passed through the username claim."
The UPN is shaped `onid@oregonstate.edu`. The mapper tries `username`,
`preferred_username` and `upn` in that order, because all three spell the UPN for
a work or school account and we have never seen a token from this tenant.

**The email claim is not guaranteed**, per Entra's own field documentation, and
Better Auth requires a unique non-null email per user. So the UPN fallback is
load-bearing: without it, a user with no `email` claim cannot sign in at all.
Falling back is not inventing an address, because the UPN is deliverable on a
domain this tenant owns.

**We do not use the default `getUserInfo`, and cannot.** Better Auth's default
takes its ID-token branch only when `sub` and `email` are both present, and
otherwise falls through to the discovered `userinfo_endpoint`. For this tenant
that endpoint is Microsoft Graph, whose OIDC response carries a fixed claim set
that does not include a tenant-custom `username`. The default therefore routes
the exact case UIT warned about to the one source that cannot answer it.

One case the fallback does not solve, and cannot: a student with a verified
password account at their ONID *email* address who then signs in with ONID and
gets no `email` claim. The fallback hands back their *UPN*, a different address,
so they get a second account rather than a link. At Oregon State the two usually
match, so this should be rare. It is inherent to an IdP that does not guarantee
the email claim, not a bug with a fix on our side.

`emailVerified` is asserted rather than read. The tenant owns the domain and has
just completed an interactive sign-in with whatever MFA the university enforces,
which is stronger proof of address control than the verification link our own
password path mails. It has two intended consequences: it fires the
project-claim hook in `src/lib/auth.ts`, and it suppresses the sign-up
verification email that a university-authenticated user must never receive.

## Account linking

`onid` is in `account.accountLinking.trustedProviders`, so an ONID sign-in links
to an existing account at the same address rather than forking a second one.

`requireLocalEmailVerified` stays at its default of `true`. A student who signed
up with a password and never clicked the verification link gets `account not
linked` on their first ONID sign-in, and `/sign-in` renders copy telling them to
verify the password account first. That refusal is deliberate. Merging an
authenticated ONID identity into an address nobody has proven would let whoever
set that password inherit the real student's account.

## Rotating the secret

The secret does not originate in AWS. UIT issue it into the Azure Key Vault
`kv-engr-coe-vault-caps`, and it is copied by hand into AWS Secrets Manager at
`eecs-capstone/onid-client-secret`. There is no sync between the two clouds, and
there should not be one for a value that changes every two years.

```bash
aws --profile aws-capstone1 secretsmanager put-secret-value \
  --secret-id eecs-capstone/onid-client-secret \
  --secret-string 'NEW_SECRET' \
  --region us-west-2

aws --profile aws-capstone1 ecs update-service \
  --cluster eecs-capstone --service eecs-capstone \
  --force-new-deployment --region us-west-2
```

**Put the expiry date in a shared calendar the day you set it.** The secret is
good for two years, does not auto-renew, and UIT do not track expiry dates.
Nothing in this stack will warn you. Sign-in simply starts failing, on a date
nobody wrote down.

## Open with UIT

These went back on 2026-08-24 and are unanswered. Until the first three are
resolved, **no part of the live flow has been exercised**: not the authorization
redirect, not the token exchange, not the claim shape.

1. **The client secret.** We cannot open the Key Vault link, so we do not have
   it. Everything else is blocked behind this.
2. **Which redirect URIs were actually registered.** The original request named
   the production URI exactly; the reply did not confirm it.
3. **A localhost redirect URI**, without which the flow cannot be tested outside
   production.
4. **Which scopes to request.** We assume `openid profile email` from the
   tenant's `scopes_supported`. Deliberately not `offline_access`: it buys a
   refresh token, and we call no API on the user's behalf.
5. **The secret's calendar expiry date**, and the rotation procedure.
6. **Who can actually sign in.** UIT say the app is published to users with an
   active engineering account. If that is narrower than ONID, a student or staff
   member with a valid ONID and no College of Engineering account cannot sign
   in, and we do not yet know what they see when they try.

One assumption worth naming separately, because it is the one most likely to be
wrong and the unit tests cannot catch it: **`username` is not a stock Entra v2.0
claim.** The tenant's discovery document advertises `preferred_username` and
does not list `username` at all, so it must come from a claims-mapping
configuration on this app registration. UIT named it in prose and no ID token
has been decoded. The mapper therefore accepts all three spellings rather
than betting on one, which should make this a non-event. What it cannot cover is
a fourth name nobody has guessed, and you will only find that out by signing in.

## What is deliberately not built

- **No affiliation mapping.** UIT release neither `eduPersonPrimaryAffiliation`
  nor `eduPersonScopedAffiliation`. `user.additionalFields.affiliation` stays a
  user-entered mentor-profile field and ONID does not touch it.
- **No ONID username column.** Storing the UPN separately from email would be a
  migration for a value nothing reads. Add it when something needs to display or
  join on an ONID.
- **No single logout.** Not requested, and signing out of this app should not
  sign a user out of every Microsoft property in the tenant.
- **No removal of email/password or GitHub sign-in.** Industry partners and
  outside faculty have no ONID, and open question 6 may narrow the ONID audience
  further.
