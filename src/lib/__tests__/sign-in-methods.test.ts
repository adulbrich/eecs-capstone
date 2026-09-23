import { describe, expect, it } from "vitest";
import { signInMethods } from "#/lib/sign-in-methods";

const NOW = new Date("2026-09-23T12:00:00Z");
const EARLIER = new Date("2026-09-23T11:00:00Z");

const verified = { banExpires: null, banned: false, emailVerified: true };
const unverified = { ...verified, emailVerified: false };

// #605: the admin user page listed "Emailed code" for rows the code guard
// refuses. These are the rows `addressProofRefused` separates.
describe("signInMethods", () => {
  it("lists the emailed code and ONID for a verified ONID row", () => {
    expect(signInMethods(verified, ["onid"], NOW)).toEqual([
      "Emailed code",
      "ONID",
    ]);
  });

  it("leaves the emailed code off an unverified row GitHub is linked to", () => {
    expect(signInMethods(unverified, ["github"], NOW)).toEqual(["GitHub"]);
  });

  it("lists the emailed code for an unverified row with only a password", () => {
    // The code takes the row, and the password is not a way in since #576.
    expect(signInMethods(unverified, ["credential"], NOW)).toEqual([
      "Emailed code",
    ]);
  });

  it("lists nothing for an unverified, banned row with only a password", () => {
    expect(
      signInMethods({ ...unverified, banned: true }, ["credential"], NOW)
    ).toEqual([]);
  });

  it("lists the emailed code once an unverified row's ban has run out", () => {
    expect(
      signInMethods(
        { ...unverified, banned: true, banExpires: EARLIER },
        ["credential"],
        NOW
      )
    ).toEqual(["Emailed code"]);
  });

  it("keeps the emailed code on a verified banned row, as the guard does", () => {
    // The guard passes it; the admin plugin refuses the session. The ban is
    // shown elsewhere on the page.
    expect(signInMethods({ ...verified, banned: true }, [], NOW)).toEqual([
      "Emailed code",
    ]);
  });
});
