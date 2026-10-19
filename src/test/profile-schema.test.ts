import { describe, expect, it } from "vitest";
import { LINKEDIN_URL_MESSAGES, profileSchema } from "#/server/profile";

const base = { name: "Dana Lee", affiliation: "OSU", linkedin: null };

describe("profileSchema mentor rules", () => {
  it("accepts an opt-in with an affiliation", () => {
    const r = profileSchema.safeParse({
      ...base,
      mentorTeamCount: 3,
      wantsToMentor: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an opt-in with a blank affiliation, on the affiliation path", () => {
    const r = profileSchema.safeParse({
      ...base,
      affiliation: "",
      mentorTeamCount: 1,
      wantsToMentor: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["affiliation"]);
    }
  });

  it("allows a blank affiliation when not opting in", () => {
    const r = profileSchema.safeParse({
      ...base,
      affiliation: "",
      mentorTeamCount: 1,
      wantsToMentor: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a team count outside 1 to 5", () => {
    expect(
      profileSchema.safeParse({
        ...base,
        mentorTeamCount: 6,
        wantsToMentor: true,
      }).success
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        ...base,
        mentorTeamCount: 0,
        wantsToMentor: true,
      }).success
    ).toBe(false);
  });

  it("stores a name without its padding", () => {
    expect(profileSchema.parse({ ...base, name: "  Ada  " }).name).toBe("Ada");
  });

  it("refuses a name of spaces, with the message an empty one gets", () => {
    const blank = profileSchema.safeParse({ ...base, name: "   " });
    const empty = profileSchema.safeParse({ ...base, name: "" });
    expect(blank.success).toBe(false);
    expect(empty.success).toBe(false);
    if (!(blank.success || empty.success)) {
      expect(blank.error.issues[0].path).toEqual(["name"]);
      expect(blank.error.issues[0].message).toBe(empty.error.issues[0].message);
    }
  });

  it("measures the 120 character limit after trimming", () => {
    const name = "a".repeat(120);
    expect(
      profileSchema.safeParse({ ...base, name: `  ${name}  ` }).success
    ).toBe(true);
    expect(profileSchema.safeParse({ ...base, name: `${name}a` }).success).toBe(
      false
    );
  });

  it("defaults wantsToMentor to false and mentorTeamCount to 1", () => {
    const r = profileSchema.parse({ name: "Dana Lee" });
    expect(r.wantsToMentor).toBe(false);
    expect(r.mentorTeamCount).toBe(1);
  });
});

describe("profileSchema LinkedIn URL", () => {
  function linkedinMessages(linkedin: string): string[] {
    const r = profileSchema.safeParse({ ...base, linkedin });
    return r.success ? [] : r.error.issues.map((issue) => issue.message);
  }

  it("accepts one https link", () => {
    expect(linkedinMessages("https://www.linkedin.com/in/x")).toEqual([]);
  });

  it.each([
    ["javascript:alert(1)", LINKEDIN_URL_MESSAGES.scheme],
    ["www.linkedin.com/in/x", LINKEDIN_URL_MESSAGES.scheme],
    ["https://a.com https://b.com", LINKEDIN_URL_MESSAGES.several],
  ])("refuses %j", (linkedin, message) => {
    expect(linkedinMessages(linkedin)).toEqual([message]);
  });
});
