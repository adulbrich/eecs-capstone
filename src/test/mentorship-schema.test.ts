import { describe, expect, it } from "vitest";
import { mentorshipSchema, proposerSchema } from "#/server/projects";

const ID = "11111111-1111-4111-8111-111111111111";

describe("mentorshipSchema", () => {
  it("accepts an address and the empty string that clears it", () => {
    expect(
      mentorshipSchema.parse({ id: ID, mentorEmail: "Mentor@Example.edu" })
        .mentorEmail
    ).toBe("Mentor@Example.edu");
    expect(
      mentorshipSchema.parse({
        id: ID,
        mentorEmail: "",
        studentProposed: false,
      }).mentorEmail
    ).toBe("");
  });

  it("carries the address and the email skip, and nothing else (#402)", () => {
    // Mentorship is the address alone: the mentor state left with #402, and
    // a client still sending one has it stripped rather than honored.
    const parsed = mentorshipSchema.parse({
      id: ID,
      mentorEmail: "",
      mentorNeed: "seeking",
      seekingMentor: true,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "id",
      "mentorEmail",
      "sendEmail",
    ]);
  });

  it("no longer carries the student-proposed mark, which the proposer schema owns", () => {
    // #336 moved the mark to the Proposer section; a client still sending it
    // here has it stripped, and the proposer schema refuses to default it.
    const parsed = mentorshipSchema.parse({ id: ID, mentorEmail: "" });
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

  it("defaults the email skip to sending, on both schemas (#379)", () => {
    // A partial caller mails rather than silently swallowing it; only an
    // explicit false is a skip.
    expect(mentorshipSchema.parse({ id: ID, mentorEmail: "" }).sendEmail).toBe(
      true
    );
    expect(
      proposerSchema.parse({
        id: ID,
        proposerEmail: "p@x.edu",
        sendEmail: false,
        studentProposed: true,
      }).sendEmail
    ).toBe(false);
  });

  it("rejects null, a non-address, and an address over the shared ceiling", () => {
    // The address is a string in transit; null exists only in the column.
    expect(
      mentorshipSchema.safeParse({ id: ID, mentorEmail: null }).success
    ).toBe(false);
    expect(
      mentorshipSchema.safeParse({ id: ID, mentorEmail: "not an address" })
        .success
    ).toBe(false);
    // Exactly 200 passes and 201 fails, so the ceiling is pinned at 200 and
    // the rejection is the length rule rather than the address format.
    const atCeiling = `${"a".repeat(194)}@x.com`;
    expect(atCeiling).toHaveLength(200);
    expect(
      mentorshipSchema.safeParse({ id: ID, mentorEmail: atCeiling }).success
    ).toBe(true);
    const over = mentorshipSchema.safeParse({
      id: ID,
      mentorEmail: `a${atCeiling}`,
    });
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((i) => i.code)).toContain("too_big");
  });
});
