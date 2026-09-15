import { describe, expect, it } from "vitest";
import { mentorshipSchema, proposerSchema } from "#/server/projects";

const ID = "11111111-1111-4111-8111-111111111111";

describe("mentorshipSchema", () => {
  it("accepts an address and the empty string that clears it", () => {
    expect(
      mentorshipSchema.parse({
        id: ID,
        mentorEmail: "Mentor@Example.edu",
        mentorNeed: "unspecified",
      }).mentorEmail
    ).toBe("Mentor@Example.edu");
    expect(
      mentorshipSchema.parse({
        id: ID,
        mentorEmail: "",
        mentorNeed: "unspecified",
        studentProposed: false,
      }).mentorEmail
    ).toBe("");
  });

  it("requires the mentor state, so a stale client cannot silently clear it", () => {
    // Every writer sends both fields (#304, #373); a payload without the
    // state is refused rather than defaulted, or an old form would reset it.
    expect(
      mentorshipSchema.safeParse({ id: ID, mentorEmail: "" }).success
    ).toBe(false);
    // The old boolean is not a state either.
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: "",
        seekingMentor: true,
      }).success
    ).toBe(false);
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: "",
        mentorNeed: "maybe",
      }).success
    ).toBe(false);
    for (const mentorNeed of ["unspecified", "seeking", "none"]) {
      expect(
        mentorshipSchema.parse({ id: ID, mentorEmail: "", mentorNeed })
          .mentorNeed
      ).toBe(mentorNeed);
    }
  });

  it("no longer carries the student-proposed mark, which the proposer schema owns", () => {
    // #336 moved the mark to the Proposer section; a client still sending it
    // here has it stripped, and the proposer schema refuses to default it.
    const parsed = mentorshipSchema.parse({
      id: ID,
      mentorEmail: "",
      mentorNeed: "unspecified",
    });
    expect("studentProposed" in parsed).toBe(false);
    expect(
      proposerSchema.safeParse({ id: ID, proposerEmail: "p@x.edu" }).success
    ).toBe(false);
    expect(
      proposerSchema.parse({
        id: ID,
        proposerEmail: "p@x.edu",
        studentProposed: true,
      }).studentProposed
    ).toBe(true);
  });

  it("rejects null, a non-address, and an address over the shared ceiling", () => {
    // The address is a string in transit; null exists only in the column.
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: null,
        mentorNeed: "unspecified",
      }).success
    ).toBe(false);
    expect(
      mentorshipSchema.safeParse({
        id: ID,
        mentorEmail: "not an address",
        mentorNeed: "unspecified",
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
        mentorNeed: "unspecified",
      }).success
    ).toBe(true);
    const over = mentorshipSchema.safeParse({
      id: ID,
      mentorEmail: `a${atCeiling}`,
      mentorNeed: "unspecified",
    });
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((i) => i.code)).toContain("too_big");
  });
});
