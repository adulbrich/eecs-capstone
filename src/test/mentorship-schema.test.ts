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
    const long = `${"a".repeat(195)}@x.com`;
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: long,
        studentProposed: false,
      }).success
    ).toBe(false);
  });
});
