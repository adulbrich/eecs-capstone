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

export function onidProfileFromIdToken(
  idToken: string | null | undefined
): OnidProfile | null {
  if (!idToken) {
    return null;
  }
  const claims = decodePayload(idToken);
  if (!claims) {
    return null;
  }

  const id = claim(claims, "sub");
  if (!id) {
    return null;
  }

  // UIT: "To my knowledge the ONID is not available via OIDC. The next-best
  // record would be the UPN, passed through the username claim." The UPN is
  // shaped onid@oregonstate.edu, so it is a real deliverable address on a
  // domain this tenant owns, not a synthesized placeholder. Entra does not
  // guarantee `email`, which is why the fallback is load-bearing rather than
  // defensive: without it, those users cannot sign in at all.
  //
  // Three names for the UPN, because we have never seen a token from this
  // tenant. `username` is what UIT said they configured, but it is not a stock
  // Entra v2.0 claim: the tenant's discovery document advertises
  // `preferred_username`, and `upn` is the optional-claim spelling of the same
  // value. For a work or school account all three carry the UPN, so trying
  // each in turn costs one line and removes the likeliest way this breaks on
  // first contact. The personal-account caveat about `preferred_username`
  // being arbitrary does not reach us: this registration is published to
  // engineering accounts in one tenant.
  const email =
    claim(claims, "email") ??
    claim(claims, "username") ??
    claim(claims, "preferred_username") ??
    claim(claims, "upn");
  if (!email) {
    return null;
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
    // Two things follow, both intended. It fires the project-claim hook in
    // `src/lib/auth.ts`, the same way a GitHub-verified email does. And it
    // suppresses the sign-up verification email, which a user the university
    // just authenticated must never be sent.
    emailVerified: true,
  };
}
