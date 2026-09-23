import { describe, expect, it } from "vitest";
import { addressProofRefused, banIsActive } from "#/lib/address-proof";

const NOW = new Date("2026-09-23T12:00:00Z");
const EARLIER = new Date("2026-09-23T11:00:00Z");
const LATER = new Date("2026-09-23T13:00:00Z");

const unverified = { banExpires: null, banned: false, emailVerified: false };

describe("banIsActive", () => {
  it.each([
    ["not banned", { banned: false, banExpires: null }, false],
    ["banned is null", { banned: null, banExpires: null }, false],
    ["banned with no expiry", { banned: true, banExpires: null }, true],
    ["banned until later", { banned: true, banExpires: LATER }, true],
    // The admin plugin clears this one at the next session and lets it in.
    ["banned until earlier", { banned: true, banExpires: EARLIER }, false],
  ])("%s", (_, row, active) => {
    expect(banIsActive(row, NOW)).toBe(active);
  });
});

describe("addressProofRefused", () => {
  it("never refuses a verified row, whatever is on it", () => {
    expect(
      addressProofRefused(
        { banExpires: null, banned: true, emailVerified: true },
        ["github"],
        NOW
      )
    ).toBe(false);
  });

  it("takes an unverified row with nothing on it but a password", () => {
    expect(addressProofRefused(unverified, ["credential"], NOW)).toBe(false);
    expect(addressProofRefused(unverified, [], NOW)).toBe(false);
  });

  it("refuses an unverified row another provider is linked to", () => {
    expect(addressProofRefused(unverified, ["credential", "github"], NOW)).toBe(
      true
    );
  });

  it("refuses an unverified row under an active ban", () => {
    expect(
      addressProofRefused(
        { ...unverified, banned: true, banExpires: LATER },
        ["credential"],
        NOW
      )
    ).toBe(true);
  });

  it("takes an unverified row whose ban has run out", () => {
    expect(
      addressProofRefused(
        { ...unverified, banned: true, banExpires: EARLIER },
        ["credential"],
        NOW
      )
    ).toBe(false);
  });
});
