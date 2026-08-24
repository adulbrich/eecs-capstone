import { describe, expect, it } from "vitest";
import { onidProfileFromIdToken } from "../_internal/onid-profile";

/**
 * Builds an unsigned JWT with the given payload. The signature is a literal
 * because nothing under test reads it: see the note in `onid-profile.ts` on why
 * a back-channel token is decoded rather than verified.
 */
function idToken(payload: Record<string, unknown>): string {
  const b64 = (value: string) => Buffer.from(value).toString("base64url");
  return `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(
    JSON.stringify(payload)
  )}.not-checked`;
}

/** The claim set UIT says they configured, for a user who has an email. */
const full = {
  sub: "8f1c9d0a-2b3e-4c5d-9e6f-7a8b9c0d1e2f",
  username: "beavers@oregonstate.edu",
  email: "benny.beaver@oregonstate.edu",
  given_name: "Benny",
  family_name: "Beaver",
};

describe("onidProfileFromIdToken", () => {
  it("prefers the email claim when the tenant releases one", () => {
    expect(onidProfileFromIdToken(idToken(full))).toEqual({
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
    expect(onidProfileFromIdToken(idToken(withoutEmail))?.email).toBe(
      "beavers@oregonstate.edu"
    );
  });

  it("returns null when neither email nor username is present", () => {
    // Better Auth turns null into a `user_info_is_missing` redirect. The
    // alternative, inventing an address from `sub`, would create an account
    // nobody can be contacted at and that no password reset can recover.
    const { email, username, ...neither } = full;
    expect(onidProfileFromIdToken(idToken(neither))).toBeNull();
  });

  it("returns null without a sub, since there is no account id to key on", () => {
    const { sub, ...withoutSub } = full;
    expect(onidProfileFromIdToken(idToken(withoutSub))).toBeNull();
  });

  it("ignores blank claims rather than treating them as present", () => {
    // Entra can release an attribute that exists but is empty. A blank email
    // must fall through to the UPN, not become the account's address.
    expect(
      onidProfileFromIdToken(idToken({ ...full, email: "   " }))?.email
    ).toBe("beavers@oregonstate.edu");
  });

  it("trims surrounding whitespace on the claims it keeps", () => {
    expect(
      onidProfileFromIdToken(
        idToken({ ...full, given_name: " Benny ", family_name: "Beaver " })
      )?.name
    ).toBe("Benny Beaver");
  });

  describe("name assembly", () => {
    it("uses whichever half of the name is present", () => {
      const { family_name, ...givenOnly } = full;
      expect(onidProfileFromIdToken(idToken(givenOnly))?.name).toBe("Benny");
    });

    it("falls back to the name claim", () => {
      const { given_name, family_name, ...withoutParts } = full;
      expect(
        onidProfileFromIdToken(
          idToken({ ...withoutParts, name: "Benny Beaver" })
        )?.name
      ).toBe("Benny Beaver");
    });

    it("falls back to the local part of the email", () => {
      // Better Auth rejects a nameless profile with `name_is_missing`, so
      // there has to be a last resort. Ugly beats unable to sign in, and the
      // user can edit it on their profile page.
      const { given_name, family_name, ...nameless } = full;
      expect(onidProfileFromIdToken(idToken(nameless))?.name).toBe(
        "benny.beaver"
      );
    });
  });

  it("asserts emailVerified even when the IdP says otherwise", () => {
    // Deliberate override, not a bug. The university just authenticated this
    // person interactively; email_verified reflects Entra's own bookkeeping
    // about the mail attribute, which is a weaker signal than the sign-in that
    // just happened. Leaving it false would mail a verification link to someone
    // who has already proven more than the link proves.
    expect(
      onidProfileFromIdToken(idToken({ ...full, email_verified: false }))
        ?.emailVerified
    ).toBe(true);
  });

  describe("malformed input", () => {
    it("returns null for a missing token", () => {
      expect(onidProfileFromIdToken(undefined)).toBeNull();
      expect(onidProfileFromIdToken(null)).toBeNull();
      expect(onidProfileFromIdToken("")).toBeNull();
    });

    it("returns null for something that is not a three-part JWT", () => {
      expect(onidProfileFromIdToken("not-a-jwt")).toBeNull();
      expect(onidProfileFromIdToken("only.two")).toBeNull();
      expect(onidProfileFromIdToken("a.b.c.d")).toBeNull();
    });

    it("returns null when the payload is not JSON", () => {
      // base64url of "{" plus a stray brace, which decodes cleanly and then
      // fails to parse. This is the throw the decoder has to swallow.
      const payload = Buffer.from("{oops").toString("base64url");
      expect(onidProfileFromIdToken(`aGVhZGVy.${payload}.sig`)).toBeNull();
    });

    it("returns null when the payload is JSON but not an object", () => {
      for (const value of ["[]", '"a string"', "42", "null"]) {
        const payload = Buffer.from(value).toString("base64url");
        expect(onidProfileFromIdToken(`aGVhZGVy.${payload}.sig`)).toBeNull();
      }
    });

    it("returns null when a claim is present but the wrong type", () => {
      expect(
        onidProfileFromIdToken(idToken({ ...full, sub: 12_345 }))
      ).toBeNull();
    });
  });
});
