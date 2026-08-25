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
| Client secrets | Two, both in Azure Key Vault `kv-engr-coe-vault-caps`: one for production, one for local development |
| Secret expiry | 2028-08-24. No auto-renewal. Renew through the UIT support portal. |
| Scopes requested | `openid profile email` |
| Claims released | `email`, `given_name`, `family_name`, and a UPN claim UIT call `username` |
| Tenancy | Single tenant, and pinned to it in code. See "Why single tenant". |
| Audience | Holders of an active College of Engineering account |

The client ID, tenant ID and discovery URL are public values. They appear in
`.env.example` and `infra/variables.tf` on purpose; treating them as secrets
buys nothing and costs every new developer a round trip.

## Redirect URIs

```
https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid
http://localhost:3000/api/auth/oauth2/callback/onid
```

Both are registered and confirmed by UIT, along with a separate development
client secret for the localhost one.

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
issuer        = must equal the tenant issuer, or the token is refused outright
id            = oid, falling back to sub
email         = email, then username, preferred_username, upn (all the UPN)
name          = given_name + family_name, then name, then the local part of email
emailVerified = true, always
```

Four things about this are worth knowing before you change any of it.

**The account id is `oid`, not `sub`.** Both are immutable GUIDs and Microsoft's
reference says either will do, but `sub` is pairwise per application ID: if the
app registration is ever recreated with a new client ID, every existing user
gets a new `sub` and therefore a second account. `oid` is per user per tenant
and survives that. `sub` stays as the fallback because Entra gates `oid` behind
the `profile` scope, which we request but do not control. Do not drop `profile`
from the scopes for the same reason.

**There is no ONID claim.** UIT: "To my knowledge the ONID is not available via
OIDC. The next-best record would be the UPN, passed through the username claim."
The UPN is shaped `onid@oregonstate.edu`. The mapper tries `username`,
`preferred_username` and `upn` in that order, because all three spell the UPN for
a work or school account and we have never seen a token from this tenant.

That belt-and-braces turned out to be warranted. Asked where `username` came
from, UIT said they had taken it from a Proxmox server's realm configuration
rather than from Entra's own claims reference, and agreed it is non-standard.
They still believe it maps to the UPN by default on Entra. Nobody has decoded a
token to check, so do not narrow the chain back to one name until somebody has.

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

## Why single tenant

UIT offered to open the registration to all Entra tenants, so that anyone with
any Microsoft work or school account could sign in. We declined, and the mapper
now refuses any token whose `iss` claim is not this tenant's issuer.

The reason is specific rather than general caution. Entra verifies the domain
suffix of a UPN, so an outsider cannot mint `student@oregonstate.edu` as a UPN.
It does not verify the `mail` attribute behind the `email` claim, and Microsoft's
claims reference says so outright: `email` "isn't guaranteed to be correct and is
mutable over time. Never use it for authorization or to save data for a user."
Our mapper reads `email` **first**, asserts `emailVerified: true`, and `onid` is
a trusted provider for account linking. Under a multi-tenant registration, that
composition is an account-takeover vector: stand up your own Entra tenant, set a
user's mail attribute to a real student's address, sign in, and Better Auth links
you into that student's account. Pinning the issuer is what forecloses it.

The expected issuer is derived from `ONID_DISCOVERY_URL` rather than configured
separately, because that URL already contains the tenant GUID and a second
variable is a second thing to get out of step. An unset discovery URL yields an
empty issuer and the mapper then refuses every token, so ONID fails closed when
it is unconfigured rather than accepting tokens from anywhere.

What the check does **not** do is make trusting `email` safe on its own. A guest
invited into the OSU tenant carries this tenant's `iss` with a home-tenant email
and passes. The email trust rests on the conjunction of the issuer pin and UIT
publishing this registration only to engineering-account holders. If that ever
stops being acceptable, `idp` differing from `iss` is the discriminator for a
guest.

Industry partners and outside faculty do not need any of this. They already have
email and password sign-in with verification, plus GitHub.

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

There are two secrets on the one client ID: a development secret for local work
and localhost sign-in, and the production one. Only the production secret belongs
in AWS.

**The production secret expires on 2028-08-24.** Put that in a shared calendar
with a reminder well ahead of it. It does not auto-renew, UIT do not track expiry
dates, and nothing in this stack will warn you: sign-in simply starts failing on
that date. Renewal is a request through the same UIT support portal that produced
the registration.

## Open with UIT

Everything asked on 2026-08-24 came back on 2026-08-25 except one thing, and it
is the one that blocks: **we still cannot read the client secrets.** UIT report
that the Key Vault Secrets User role was assigned at vault creation and suspect a
tenant misconfiguration rather than a missing grant; the suggested workaround is
to sign in at `portal.azure.com`, accept the error prompt, and search for
`kv-engr-coe-vault-caps` instead of following a direct link. Until that works,
**no part of the live flow has been exercised**: not the authorization redirect,
not the token exchange, not the claim shape.

Answered, and folded into this document: both redirect URIs are registered, a
development secret exists for localhost, `openid profile email` is sufficient,
`oid` is the identifier to key on, and the secret expires 2028-08-24.

Two answers worth keeping visible because they shape the product rather than the
code:

- **A user without access sees a generic Entra error**, and UIT confirm it is not
  customizable. We cannot detect that case or explain it in our own UI, because
  the user never reaches our application. Anyone turned away has to be told out
  of band that ONID sign-in requires an active College of Engineering account and
  that email and password sign-in is the alternative.
- **UIT have not published to external users before** and cannot confirm in
  advance whether it would work. Moot now that we are staying single tenant.

One assumption remains untestable from here: the UPN claim name. UIT took
`username` from a Proxmox realm configuration and agree it is non-standard, so
the mapper accepts `username`, `preferred_username` and `upn`. That should make
it a non-event. What it cannot cover is a fourth name nobody has guessed, and you
will only find that out by signing in.

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
