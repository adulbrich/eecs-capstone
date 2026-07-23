import { describe, expect, it } from "vitest";
import { profileSchema } from "#/server/profile";

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

  it("defaults wantsToMentor to false and mentorTeamCount to 1", () => {
    const r = profileSchema.parse({ name: "Dana Lee" });
    expect(r.wantsToMentor).toBe(false);
    expect(r.mentorTeamCount).toBe(1);
  });
});
