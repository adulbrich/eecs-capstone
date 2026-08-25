import { describe, expect, it } from "vitest";
import {
  issuerFromDiscoveryUrl,
  onidProfileFromIdToken,
} from "../_internal/onid-profile";

const TENANT = "ce6d05e1-3c5e-4d62-87a8-4c4a2713c113";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

/**
 * Builds an unsigned JWT with the given payload, defaulting `iss` to the tenant
 * every test but the issuer-pinning ones assumes. The signature is a literal
 * because nothing under test reads it: see the note in `onid-profile.ts` on why
 * a back-channel token is decoded rather than verified.
 */
function idToken(payload: Record<string, unknown>): string {
  const b64 = (value: string) => Buffer.from(value).toString("base64url");
  return `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(
    JSON.stringify({ iss: ISSUER, ...payload })
  )}.not-checked`;
}

/** Every case but the issuer tests runs against the configured tenant. */
function profileOf(token: string | null | undefined) {
  return onidProfileFromIdToken(token, ISSUER);
}

/** The claim set UIT says they configured, for a user who has an email. */
const full = {
  oid: "8f1c9d0a-2b3e-4c5d-9e6f-7a8b9c0d1e2f",
  sub: "pairwise-subject-for-this-app",
  username: "beavers@oregonstate.edu",
  email: "benny.beaver@oregonstate.edu",
  given_name: "Benny",
  family_name: "Beaver",
};

describe("onidProfileFromIdToken", () => {
  it("prefers the email claim when the tenant releases one", () => {
    expect(profileOf(idToken(full))).toEqual({
      id: "8f1c9d0a-2b3e-4c5d-9e6f-7a8b9c0d1e2f",
      email: "benny.beaver@oregonstate.edu",
      name: "Benny Beaver",
      emailVerified: true,
    });
  });

  it("falls back to the UPN in username when email is absent", () => {
    // The case UIT warned about: "Per Entra field documentation, the email
    // field is not guaranteed." The UPN is onid@oregonstate.edu, deliverable
    // on a domain the tenant owns.
    const { email, ...withoutEmail } = full;
    expect(profileOf(idToken(withoutEmail))?.email).toBe(
      "beavers@oregonstate.edu"
    );
  });

  it("falls back to preferred_username, the stock Entra spelling", () => {
    // UIT named `username`, but that is not a stock v2.0 claim and no token
    // from this tenant has been decoded. For a work or school account
    // preferred_username carries the same UPN.
    const { email, username, ...withoutEither } = full;
    expect(
      profileOf(
        idToken({
          ...withoutEither,
          preferred_username: "beavers@oregonstate.edu",
        })
      )?.email
    ).toBe("beavers@oregonstate.edu");
  });

  it("falls back to upn, the optional-claim spelling", () => {
    const { email, username, ...withoutEither } = full;
    expect(
      profileOf(idToken({ ...withoutEither, upn: "beavers@oregonstate.edu" }))
        ?.email
    ).toBe("beavers@oregonstate.edu");
  });

  it("prefers username over the other two UPN spellings", () => {
    const { email, ...withoutEmail } = full;
    expect(
      profileOf(
        idToken({
          ...withoutEmail,
          preferred_username: "other@oregonstate.edu",
          upn: "another@oregonstate.edu",
        })
      )?.email
    ).toBe("beavers@oregonstate.edu");
  });

  it("returns null when no email and no UPN spelling is present", () => {
    // Better Auth turns null into a `user_info_is_missing` redirect. The
    // alternative, inventing an address from `sub`, would create an account
    // nobody can be contacted at and that no password reset can recover.
    const { email, username, ...neither } = full;
    expect(profileOf(idToken(neither))).toBeNull();
  });

  describe("account id", () => {
    it("prefers oid over sub", () => {
      // Both are immutable GUIDs, but sub is pairwise per application ID, so a
      // re-registered app forks every existing account. oid survives that.
      expect(profileOf(idToken(full))?.id).toBe(full.oid);
    });

    it("falls back to sub when oid is absent", () => {
      // oid is gated behind the profile scope. If that ever stops being
      // granted, signing in still works rather than failing outright.
      const { oid, ...withoutOid } = full;
      expect(profileOf(idToken(withoutOid))?.id).toBe(
        "pairwise-subject-for-this-app"
      );
    });

    it("returns null when neither is present", () => {
      const { oid, sub, ...neither } = full;
      expect(profileOf(idToken(neither))).toBeNull();
    });
  });

  describe("issuer pinning", () => {
    it("rejects a token from another tenant", () => {
      // The whole point. Under a multi-tenant registration `email` is whatever
      // the signing-in tenant's admin typed, and Entra does not verify it. An
      // attacker with their own tenant could set a user's mail to a real
      // student's address and be linked straight into that student's account.
      const other = "https://login.microsoftonline.com/some-other-tenant/v2.0";
      expect(
        onidProfileFromIdToken(idToken({ ...full, iss: other }), ISSUER)
      ).toBeNull();
    });

    it("rejects a token with no issuer claim at all", () => {
      expect(
        onidProfileFromIdToken(idToken({ ...full, iss: undefined }), ISSUER)
      ).toBeNull();
    });

    it("refuses every token when no issuer is configured", () => {
      // ONID_DISCOVERY_URL unset. Failing closed matters more than failing
      // helpfully: the alternative is accepting tokens from anywhere.
      expect(onidProfileFromIdToken(idToken(full), "")).toBeNull();
      expect(onidProfileFromIdToken(idToken(full), "   ")).toBeNull();
    });
  });

  describe("issuerFromDiscoveryUrl", () => {
    it("strips the well-known suffix, leaving the tenant issuer", () => {
      expect(
        issuerFromDiscoveryUrl(`${ISSUER}/.well-known/openid-configuration`)
      ).toBe(ISSUER);
    });

    it("tolerates a trailing slash and surrounding whitespace", () => {
      expect(
        issuerFromDiscoveryUrl(
          `  ${ISSUER}/.well-known/openid-configuration/  `
        )
      ).toBe(ISSUER);
    });

    it("maps an unset discovery URL to an empty issuer", () => {
      expect(issuerFromDiscoveryUrl("")).toBe("");
    });
  });

  it("ignores blank claims rather than treating them as present", () => {
    // Entra can release an attribute that exists but is empty. A blank email
    // must fall through to the UPN, not become the account's address.
    expect(profileOf(idToken({ ...full, email: "   " }))?.email).toBe(
      "beavers@oregonstate.edu"
    );
  });

  it("trims surrounding whitespace on the claims it keeps", () => {
    expect(
      profileOf(
        idToken({ ...full, given_name: " Benny ", family_name: "Beaver " })
      )?.name
    ).toBe("Benny Beaver");
  });

  describe("name assembly", () => {
    it("uses whichever half of the name is present", () => {
      const { family_name, ...givenOnly } = full;
      expect(profileOf(idToken(givenOnly))?.name).toBe("Benny");
    });

    it("falls back to the name claim", () => {
      const { given_name, family_name, ...withoutParts } = full;
      expect(
        profileOf(idToken({ ...withoutParts, name: "Benny Beaver" }))?.name
      ).toBe("Benny Beaver");
    });

    it("falls back to the local part of the email", () => {
      // Better Auth rejects a nameless profile with `name_is_missing`, so
      // there has to be a last resort. Ugly beats unable to sign in, and the
      // user can edit it on their profile page.
      const { given_name, family_name, ...nameless } = full;
      expect(profileOf(idToken(nameless))?.name).toBe("benny.beaver");
    });
  });

  it("asserts emailVerified even when the IdP says otherwise", () => {
    // Deliberate override, not a bug. The university just authenticated this
    // person interactively; email_verified reflects Entra's own bookkeeping
    // about the mail attribute, which is a weaker signal than the sign-in that
    // just happened. Leaving it false would mail a verification link to someone
    // who has already proven more than the link proves.
    expect(
      profileOf(idToken({ ...full, email_verified: false }))?.emailVerified
    ).toBe(true);
  });

  describe("malformed input", () => {
    it("returns null for a missing token", () => {
      expect(profileOf(undefined)).toBeNull();
      expect(profileOf(null)).toBeNull();
      expect(profileOf("")).toBeNull();
    });

    it("returns null for something that is not a three-part JWT", () => {
      expect(profileOf("not-a-jwt")).toBeNull();
      expect(profileOf("only.two")).toBeNull();
      expect(profileOf("a.b.c.d")).toBeNull();
    });

    it("returns null when the payload is not JSON", () => {
      // base64url of "{" plus a stray brace, which decodes cleanly and then
      // fails to parse. This is the throw the decoder has to swallow.
      const payload = Buffer.from("{oops").toString("base64url");
      expect(profileOf(`aGVhZGVy.${payload}.sig`)).toBeNull();
    });

    it("returns null when the payload is JSON but not an object", () => {
      for (const value of ["[]", '"a string"', "42", "null"]) {
        const payload = Buffer.from(value).toString("base64url");
        expect(profileOf(`aGVhZGVy.${payload}.sig`)).toBeNull();
      }
    });

    it("returns null when a claim is present but the wrong type", () => {
      expect(
        profileOf(idToken({ ...full, oid: 12_345, sub: 12_345 }))
      ).toBeNull();
    });
  });
});
