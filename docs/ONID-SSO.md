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
| SAML 2.0 only | Separate `@better-auth/sso` package, SP metadata and signing certs, and an SP registration that is either local to their IdP or via InCommon | Materially larger. |
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
  (this is the `better-auth` 1.6 path shape and it moves in 1.7, so read the pin
  note under "Notes for whoever implements it" before you register)
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

I am deploying a web application for the EECS Capstone program at
`https://capstone.eecs.oregonstate.edu` and would like students, faculty and
staff to sign in with their ONID account rather than maintaining a separate
password. The app currently supports email/password and GitHub sign-in; ONID
would become the primary path.

**My first question:** can you register the application as an OpenID Connect
relying party, or is SAML 2.0 the only option for an application like this? I
can implement either, but OIDC is substantially less work and I would prefer it
if it is available.

**If OIDC, I need:**

- The issuer or discovery URL (`.../.well-known/openid-configuration`)
- A `client_id` and `client_secret`
- Confirmation of this redirect URI, which I need allowlisted exactly:
  `https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid`
- The scopes I should request
- **Claim names**, specifically: which claim carries the ONID username, which
  carries the email address, which carries given and family name, and whether
  you release `eduPersonPrimaryAffiliation` or `eduPersonScopedAffiliation`
- Whether the email claim is **guaranteed present and verified** for every user

**If SAML 2.0, I need:**

- Your **IdP metadata URL**, or failing that the IdP entityID, SSO entry point
  and signing certificate
- **Registration of the application as a Service Provider.** Its values are:
  - entityID (proposed):
    `https://capstone.eecs.oregonstate.edu/api/auth/sso/saml2/sp/metadata`
  - Assertion Consumer Service URL, HTTP-POST binding:
    `https://capstone.eecs.oregonstate.edu/api/auth/sso/saml2/sp/acs/onid`
  - SP metadata, served once I have the IdP details above:
    `https://capstone.eecs.oregonstate.edu/api/auth/sso/saml2/sp/metadata?providerId=onid`

  The metadata document is not live yet, because the application will not serve
  it until it has your entry point and certificate. The two values above are
  what it will contain. If you have an entityID naming convention for campus
  applications, tell me and I will adopt it instead of the proposal.
- **Whether you register the application locally in your IdP, or whether this
  has to go through InCommon.** I would prefer a local registration if you
  support it. I cannot register an `oregonstate.edu` entity in InCommon myself,
  so if that is the required path I would need you to sponsor it, and I would
  like to know the lead time.
- The **NameID format** you release, and whether it is persistent for a given
  user. A transient NameID would not let the application recognize a returning
  user.
- The **attribute release** you can offer, specifically `eduPersonPrincipalName`,
  `mail`, `givenName`, `sn`, `displayName`, and `eduPersonPrimaryAffiliation` or
  `eduPersonScopedAffiliation`. As with OIDC, I need to know whether `mail` is
  released for every user and whether anything in the assertion indicates that
  the address is verified.
- Whether you require **signed AuthnRequests** or **encrypted assertions**. The
  application is a Node/TypeScript service using a standards-compliant SAML 2.0
  SP library, which supports both, so I can supply an SP signing certificate if
  you need one. I mention the stack only because the ACS path above will not
  look like the Shibboleth SP or SimpleSAMLphp shapes you normally see; it is a
  conventional SAML 2.0 SP in every other respect.
- Whether you require **Single Logout**, and over which binding. I would rather
  find out now than after registration.

**Two process questions, either way:**

1. Is there a **test or staging IdP** I can integrate against, or does
   registration go straight to production?
2. Does attribute release require a **security review or data classification
   form** first? If so I would like to start that now rather than after the
   technical work.

I am requesting only identity attributes for authentication and display. I do
not need grades, holds, financial or any other student record data.

---

## Notes for whoever implements it

- **The redirect URI shape differs from the existing GitHub one.** GitHub uses
  `/api/auth/callback/github` (see `DEPLOYMENT.md` §11). The `genericOAuth`
  plugin mounts a different path, `/api/auth/oauth2/callback/:providerId`. Pasting
  the GitHub shape into the ticket costs a round trip with UIT, so send the
  `oauth2` form above.
- **Pin `better-auth` before sending the ticket.** That `oauth2` URL is the 1.6
  shape. `package.json` asks for `^1.6.13`, 1.6.25 is installed and 1.6.26 is
  the newest published release, so the URL above is correct today. But the 1.7
  upgrade guide rebuilds `genericOAuth` on the social-provider path and moves
  the callback to `/api/auth/callback/:id`, converging with GitHub's shape and
  making the bullet above obsolete. A caret range accepts 1.7 the day it ships,
  so a routine `npm update` after UIT has allowlisted the `oauth2` URL would
  break sign-in with no code change. Pin to `~1.6` before sending, and treat the
  upgrade as a change that needs a new URL allowlisted. The SAML ACS path is not
  affected: 1.7 documents the same `/sso/saml2/sp/acs/:providerId` shape.
- **The ticket names the stack in the SAML branch and deliberately not in the
  OIDC branch.** This is not an inconsistency to tidy up. An OIDC registration
  is library-agnostic: UIT issue a client ID and secret and allowlist a redirect
  URI, and what consumes the token is not their concern, so naming the library
  there only invites a question about approved software lists. SAML is different
  because `/api/auth/sso/saml2/sp/acs/onid` matches neither the Shibboleth SP
  shape (`/Shibboleth.sso/SAML2/POST`) nor the SimpleSAMLphp one, and an ACS URL
  an admin does not recognize reads as a mistake. One clause naming the stack
  buys off that round trip. Keep it capability-first for the same reason: a
  competent SP declaring what it supports gets registered, whereas a request for
  help with an unfamiliar library gets triaged.
- **Single Logout is an open question, not a known capability.** `@better-auth/sso`
  advertised SP- and IdP-initiated SLO in the 1.5 release announcement, but the
  current SSO plugin reference documentation does not mention `enableSingleLogout`
  or any logout endpoint. That is why the ticket asks whether UIT require SLO
  rather than claiming support for it. If they do require it, verify against the
  installed package before promising anything, because some campus IdPs treat
  SLO as mandatory for registration and that would be the point at which this
  route needs re-costing.
- **Affiliation already has a home.** `src/lib/auth.ts` declares
  `user.additionalFields.affiliation`, so `eduPersonPrimaryAffiliation` maps
  straight onto an existing column rather than needing a migration. Worth naming
  in the ticket for that reason.
- **Email is load-bearing for account linking.** Better Auth links a social
  identity to an existing account by email. If ONID does not release a verified
  email, a student who already signed up with email/password gets a second,
  disconnected account. This is why the ticket asks whether email is guaranteed.
  On the SAML branch the NameID is the same kind of load-bearing value, for a
  different reason: it is the stable subject identifier, and `@better-auth/sso`
  maps it through `samlConfig.mapping.id`. A transient NameID changes on every
  login, so each sign-in would look like a new user. That is why the ticket asks
  for the format rather than assuming one. `mapping.emailVerified` is also a
  real field in that config, which is what the question about a verification
  signal in the assertion is for.
- **`requireEmailVerification: true` needs thought.** It is set in
  `src/lib/auth.ts` for the email/password path. An ONID user has already been
  authenticated by the university, and must not land in an email-verification
  loop on first sign-in. Check this behavior when the provider is wired up.
- **The client secret goes to Secrets Manager**, alongside
  `GITHUB_CLIENT_SECRET` in `infra/secrets.tf`, not into `infra/ecs.tf` as a
  plain environment variable. The non-secret client ID follows
  `GITHUB_CLIENT_ID` and can sit in the task definition.
