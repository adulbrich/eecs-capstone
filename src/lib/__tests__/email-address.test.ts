import { describe, expect, it } from "vitest";
import { normalizeEmailAddress } from "../email-address";

describe("normalizeEmailAddress", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmailAddress("  Sam@Oregonstate.EDU ")).toBe(
      "sam@oregonstate.edu"
    );
  });

  it("leaves an already normal address alone", () => {
    expect(normalizeEmailAddress("sam@oregonstate.edu")).toBe(
      "sam@oregonstate.edu"
    );
  });

  it("collapses empty, whitespace, null and undefined to null", () => {
    // An empty string is not a value: storing one blanks a cell that has a
    // holder, which is the same rule holdFromInput enforces with || over ??.
    expect(normalizeEmailAddress("")).toBeNull();
    expect(normalizeEmailAddress("   ")).toBeNull();
    expect(normalizeEmailAddress(null)).toBeNull();
    expect(normalizeEmailAddress(undefined)).toBeNull();
  });

  it("does not touch anything but case and surrounding space", () => {
    // Plus tags and dots are meaningful to some providers and are not this
    // function's to strip. Deduplicating aliases is a different decision and
    // has not been made.
    expect(normalizeEmailAddress("Sam+Capstone@Oregonstate.edu")).toBe(
      "sam+capstone@oregonstate.edu"
    );
  });
});
