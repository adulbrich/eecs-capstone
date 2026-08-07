# Adding ONID sign-in

What to ask OSU for, and what each answer costs to build. Nothing here is
implemented yet: `src/lib/auth.ts` currently has GitHub as its only social
provider. This is the request stage.

## The one question that decides everything

Every other detail follows from this, so ask it first and ask it plainly:

> Can you register our web app as an **OpenID Connect relying party**, or is
> **SAML 2.0** the only federation option for a campus-hosted application?

| Answer | What we build | Effort |
|---|---|---|
| OIDC | `genericOAuth` plugin, already in the `better-auth` package | Small. Config plus a secret. |
| SAML 2.0 only | Separate `@better-auth/sso` package, InCommon SP registration, metadata and signing certs | Materially larger. |
| API-gateway OAuth | `genericOAuth` with a custom `getUserInfo` | Small, with caveats below. |

Do not assert in the ticket which one OSU runs. `login.oregonstate.edu` resolves
to `login_oregonstate_edu.alias.cirrusidentity.com`, and Cirrus Identity is a
higher-ed vendor whose usual posture is a hosted Shibboleth IdP in InCommon.
That is a hint, not a fact about what they will offer us, and guessing wrong in
the ticket invites a correction round trip instead of an answer.

## The developer portal is probably not the answer, but it is cheap to test

`developer.oregonstate.edu` lets you register an app yourself, with a Callback
URL field and three-legged OAuth, so it looks like the fast path.

**Read this before registering anything: that portal is an API gateway, not an
identity provider.** Every API on its list is a data API (Persons, Students,
Directory, Terms) and none is an OIDC discovery or `userinfo` endpoint. At best
this is OAuth-as-login rather than SSO: the user authenticates, we receive an
access token, and we then have to call an identity API to work out who they are.
It may not be able to log anyone in at all. Three things have to be true, and if
any is false the route is a dead end:

1. **Does three-legged OAuth authenticate the end user against ONID**, with
   campus MFA, or does it only authorize the app? Some gateway tenants enable
   only two-legged (`client_credentials`), which cannot log anyone in.
2. **Can we resolve the token holder's own identity?** `Persons v3 - get by ID`
   needs an ID we do not have yet. We need an endpoint that answers "who is this
   token" without one. If none exists, the flow cannot identify the user.
3. **Is a verified email address always returned?** See the account-linking note
   below.

Those are answerable by registering a throwaway app and trying it, which costs
nothing and needs no ticket, so it is worth doing in parallel with the UIT
request rather than instead of it. If the answers come back no, say so in the
ticket: it usefully narrows their reply.

To register, use:

- **Callback URL**: `https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid`
- **Internal name**: `capstone` (lowercase, numbers and underscores only)
- **APIs**: `Identities v3 test` (or `Identities v2`), plus `Persons v3 - get by
  ID` and `Persons v3 - emails`. Add `Directory v2` if name and affiliation turn
  out not to be carried by those. Names are copied verbatim from the portal's
  list; the `test` suffix on the v3 entry suggests it is not production, which
  is itself worth asking about.

## The UIT ticket

Paste this, filling in the contact and timeline.

---

**Subject:** OIDC (or SAML) registration for the EECS Capstone web application

We are deploying a web application for the EECS Capstone program at
`https://capstone.eecs.oregonstate.edu` and would like students, faculty and
staff to sign in with their ONID account rather than maintaining a separate
password. The app currently supports email/password and GitHub sign-in; ONID
would become the primary path.

**Our first question:** can you register us as an OpenID Connect relying party,
or is SAML 2.0 the only option for an application like ours? We can implement
either, but OIDC is substantially less work for us and we would prefer it if it
is available.

**If OIDC, we need:**

- The issuer or discovery URL (`.../.well-known/openid-configuration`)
- A `client_id` and `client_secret`
- Confirmation of this redirect URI, which we need allowlisted exactly:
  `https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid`
- The scopes we should request
- **Claim names**, specifically: which claim carries the ONID username, which
  carries the email address, which carries given and family name, and whether
  you release `eduPersonPrimaryAffiliation` or `eduPersonScopedAffiliation`
- Whether the email claim is **guaranteed present and verified** for every user

**If SAML 2.0, we need** your IdP metadata URL, the attribute release you can
offer (the same list as above), and confirmation of our SP entityID and ACS URL
so we can register correctly, in InCommon if that is the expected path.

**Two process questions, either way:**

1. Is there a **test or staging IdP** we can integrate against, or does
   registration go straight to production?
2. Does attribute release require a **security review or data classification
   form** first? If so we would like to start that now rather than after the
   technical work.

We are requesting only identity attributes for authentication and display. We do
not need grades, holds, financial or any other student record data.

---

## Notes for whoever implements it

- **The redirect URI shape differs from the existing GitHub one.** GitHub uses
  `/api/auth/callback/github` (see `DEPLOYMENT.md` §11). The `genericOAuth`
  plugin mounts a different path, `/api/auth/oauth2/callback/:providerId`. Pasting
  the GitHub shape into the ticket costs a round trip with UIT, so send the
  `oauth2` form above.
- **Affiliation already has a home.** `src/lib/auth.ts` declares
  `user.additionalFields.affiliation`, so `eduPersonPrimaryAffiliation` maps
  straight onto an existing column rather than needing a migration. Worth naming
  in the ticket for that reason.
- **Email is load-bearing for account linking.** Better Auth links a social
  identity to an existing account by email. If ONID does not release a verified
  email, a student who already signed up with email/password gets a second,
  disconnected account. This is why the ticket asks whether email is guaranteed.
- **`requireEmailVerification: true` needs thought.** It is set in
  `src/lib/auth.ts` for the email/password path. An ONID user has already been
  authenticated by the university, and must not land in an email-verification
  loop on first sign-in. Check this behavior when the provider is wired up.
- **The client secret goes to Secrets Manager**, alongside
  `GITHUB_CLIENT_SECRET` in `infra/secrets.tf`, not into `infra/ecs.tf` as a
  plain environment variable. The non-secret client ID follows
  `GITHUB_CLIENT_ID` and can sit in the task definition.
