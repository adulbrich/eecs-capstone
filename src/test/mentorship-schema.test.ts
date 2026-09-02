import { describe, expect, it } from "vitest";
import { mentorshipSchema } from "#/server/projects";

const ID = "11111111-1111-4111-8111-111111111111";

describe("mentorshipSchema", () => {
  it("accepts an address and the empty string that clears it", () => {
    expect(
      mentorshipSchema.parse({
        id: ID,
        mentorEmail: "Mentor@Example.edu",
        studentProposed: true,
      }).mentorEmail
    ).toBe("Mentor@Example.edu");
    expect(
      mentorshipSchema.parse({
        id: ID,
        mentorEmail: "",
        studentProposed: false,
      }).mentorEmail
    ).toBe("");
  });

  it("rejects null, a non-address, and an address over the shared ceiling", () => {
    // The address is a string in transit; null exists only in the column.
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: null,
        studentProposed: false,
      }).success
    ).toBe(false);
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: "not an address",
        studentProposed: false,
      }).success
    ).toBe(false);
    // Exactly 200 passes and 201 fails, so the ceiling is pinned at 200 and
    // the rejection is the length rule rather than the address format.
    const atCeiling = `${"a".repeat(194)}@x.com`;
    expect(atCeiling).toHaveLength(200);
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: atCeiling,
        studentProposed: false,
      }).success
    ).toBe(true);
    const over = mentorshipSchema.safeParse({
      id: ID,
      mentorEmail: `a${atCeiling}`,
      studentProposed: false,
    });
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((i) => i.code)).toContain("too_big");
  });
});
