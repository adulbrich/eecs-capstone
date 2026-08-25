/**
 * Maps an Entra ID token to the user record Better Auth creates for ONID.
 *
 * This exists because Better Auth's own `getUserInfo` cannot do the job. Its
 * ID-token branch requires BOTH `sub` and `email` to be present
 * (`better-auth/dist/plugins/generic-oauth/routes.mjs`), and falls through to
 * the discovered `userinfo_endpoint` otherwise. For this tenant that endpoint
 * is Microsoft Graph, whose OIDC response carries a fixed claim set and not the
 * tenant-custom `username` claim. So the one case UIT warned us about, a user
 * with no email claim, is exactly the case the default handler routes to the
 * one source that cannot answer it.
 *
 * Reading the ID token and nothing else also takes an outbound call to Graph
 * off the sign-in path.
 *
 * The token is not signature-verified, deliberately. It arrives in the response
 * body of a back-channel POST we make ourselves, to an endpoint discovered over
 * TLS from the tenant's discovery document, authenticated with the client
 * secret. OpenID Connect Core 3.1.3.7 permits skipping validation for a token
 * obtained that way, and Better Auth's default decodes without verifying for
 * the same reason.
 */

export interface OnidProfile {
  email: string;
  emailVerified: true;
  id: string;
  name: string;
}

const DISCOVERY_SUFFIX = /\/\.well-known\/openid-configuration\/?$/;

/**
 * The issuer a token must carry, derived from the discovery URL we were
 * configured with. For Entra that is `https://login.microsoftonline.com/<tenant
 * id>/v2.0`, so pinning it pins the tenant.
 *
 * The discovery URL must name the tenant by GUID. Entra also resolves one built
 * on a domain name, but the `iss` claim is always the GUID form, so a
 * domain-shaped URL would derive an issuer no token can ever match.
 */
export function issuerFromDiscoveryUrl(discoveryUrl: string): string {
  return discoveryUrl.trim().replace(DISCOVERY_SUFFIX, "");
}

/** Reads a claim only when it is a non-blank string. */
function claim(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function decodePayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    // A malformed token is a null profile, not a thrown error. Better Auth
    // turns null into a `user_info_is_missing` redirect, which is a sign-in
    // the user can retry rather than a 500.
    return null;
  }
}

/** Why a token was refused. Never carries a claim value, only a reason. */
export interface OnidRejection {
  rejected: string;
}

/**
 * The mapping, with the reason for a refusal instead of a bare null.
 *
 * Six different conditions reject a token and Better Auth collapses all of them
 * into one `user_info_is_missing` redirect, so without a reason the first real
 * sign-in failure is a guessing game: wrong issuer, no `oid`, or a UPN under a
 * fourth claim name all look identical from the browser. Exported separately
 * from the logging wrapper so tests can assert which guard fired.
 */
export function onidProfileOrRejection(
  idToken: string | null | undefined,
  expectedIssuer: string
): OnidProfile | OnidRejection {
  if (!idToken) {
    return { rejected: "the token response carried no id_token" };
  }
  if (!expectedIssuer.trim()) {
    return {
      rejected:
        "ONID_DISCOVERY_URL is unset, so there is no issuer to check against",
    };
  }
  const claims = decodePayload(idToken);
  if (!claims) {
    return { rejected: "the id_token payload did not decode to a JSON object" };
  }

  // Pin the tenant. Microsoft's guidance is to "use the GUID portion of the
  // [iss] claim to restrict the set of tenants that can sign in to the app",
  // and this application is meant for one tenant only.
  //
  // This is not paranoia about today's registration, which is single-tenant.
  // It is what keeps the email trust below from becoming an account-takeover
  // vector if the registration is ever widened. In a multi-tenant app, `email`
  // is whatever the signing-in tenant's admin typed: Entra verifies the domain
  // suffix of a UPN but not the `mail` attribute, and the claims reference says
  // plainly that `email` "isn't guaranteed to be correct" and to "never use it
  // for authorization". Someone could stand up their own tenant, set a user's
  // mail to a real student's address, and be linked straight into that
  // student's account. Pinning the issuer is what makes that impossible.
  //
  // The expected issuer must be the GUID form. Entra resolves a discovery URL
  // built on a domain name too, but the `iss` claim is always the GUID, so a
  // domain-shaped ONID_DISCOVERY_URL derives an issuer that can never match.
  if (claim(claims, "iss") !== expectedIssuer.trim()) {
    return {
      rejected:
        "the id_token issuer is not the configured tenant, so the token was refused",
    };
  }

  // `oid` over `sub` on UIT's advice, and Microsoft's: both are immutable
  // GUIDs, but `sub` is pairwise per application ID, so a re-registered app
  // hands every existing user a new one and forks their account. `oid` is
  // per-user-per-tenant and survives that. `sub` remains the fallback because
  // `oid` requires the `profile` scope, which we request but do not control.
  const id = claim(claims, "oid") ?? claim(claims, "sub");
  if (!id) {
    return {
      rejected:
        "the id_token carried neither an oid nor a sub claim, so there is no account id",
    };
  }

  // UIT: "To my knowledge the ONID is not available via OIDC. The next-best
  // record would be the UPN, passed through the username claim." The UPN is
  // shaped onid@oregonstate.edu, so it is a real deliverable address on a
  // domain this tenant owns, not a synthesized placeholder. Entra does not
  // guarantee `email`, which is why the fallback is load-bearing rather than
  // defensive: without it, those users cannot sign in at all.
  //
  // Three names for the UPN, because we have never seen a token from this
  // tenant. UIT named `username`, then told us where it came from: a Proxmox
  // realm configuration, not Entra's own reference, and they concede it is
  // non-standard. The tenant's discovery document advertises
  // `preferred_username`, and `upn` is the optional-claim spelling of the same
  // value. For a work or school account all three carry the UPN, so trying each
  // in turn costs one line and removes the likeliest way this breaks on first
  // contact. Do not narrow this back to one name until a real token says which.
  //
  // The personal-account caveat about `preferred_username` being arbitrary does
  // not reach us: the issuer check above pins this to one tenant.
  const email =
    claim(claims, "email") ??
    claim(claims, "username") ??
    claim(claims, "preferred_username") ??
    claim(claims, "upn");
  if (!email) {
    return {
      rejected:
        "the id_token carried no email, username, preferred_username or upn claim",
    };
  }

  const given = claim(claims, "given_name");
  const family = claim(claims, "family_name");
  const name =
    [given, family].filter(Boolean).join(" ") ||
    claim(claims, "name") ||
    email.split("@")[0];

  return {
    id,
    email,
    name,
    // An assertion, not a passthrough, and it overrides `email_verified` when
    // the IdP sends one. The tenant owns oregonstate.edu, controls the mailbox,
    // and has just completed an interactive sign-in with whatever MFA the
    // university enforces. That is stronger proof of address control than the
    // verification link our own password path mails out.
    //
    // What makes it sound is the conjunction of the issuer check above and
    // UIT publishing this registration only to engineering-account holders,
    // not the email claim itself, which Entra does not verify. A guest invited
    // into the OSU tenant would pass the issuer check while carrying a
    // home-tenant email; `idp` differing from `iss` is the discriminator if
    // that ever stops being acceptable.
    //
    // Two things follow, both intended. It fires the project-claim hook in
    // `src/lib/auth.ts`, the same way a GitHub-verified email does. And it
    // suppresses the sign-up verification email, which a user the university
    // just authenticated must never be sent.
    emailVerified: true,
  };
}

/**
 * What `genericOAuth` calls. Logs the reason for a refusal and hands Better Auth
 * the `null` it expects.
 *
 * The log is the point. Every rejection reaches the user as the same opaque
 * message, so without this line the first failure after UIT release the client
 * secret would be undiagnosable from the outside. The reason never includes a
 * claim value.
 */
export function onidProfileFromIdToken(
  idToken: string | null | undefined,
  expectedIssuer: string
): OnidProfile | null {
  const result = onidProfileOrRejection(idToken, expectedIssuer);
  if ("rejected" in result) {
    console.error(`ONID sign-in refused a token: ${result.rejected}`);
    return null;
  }
  return result;
}
