import { describe, expect, it } from "vitest";
import { slotsHint } from "../analytics-copy";

describe("slotsHint", () => {
  it("says not set rather than comparing against zero", () => {
    expect(
      slotsHint({
        expectedTeams: null,
        expectedTeamsPrograms: { set: 0, total: 1 },
        publishedTeamSlots: 6,
      })
    ).toBe("Expected teams not set on the program");
    expect(
      slotsHint({
        expectedTeams: null,
        expectedTeamsPrograms: { set: 0, total: 3 },
        publishedTeamSlots: 6,
      })
    ).toBe("Expected teams not set on any program");
  });

  it("compares when every program in scope has a value", () => {
    expect(
      slotsHint({
        expectedTeams: 8,
        expectedTeamsPrograms: { set: 1, total: 1 },
        publishedTeamSlots: 6,
      })
    ).toBe("8 expected, 2 short");
    expect(
      slotsHint({
        expectedTeams: 5,
        expectedTeamsPrograms: { set: 2, total: 2 },
        publishedTeamSlots: 6,
      })
    ).toBe("5 expected, covered");
  });

  it("names a partial denominator instead of passing it off as the whole", () => {
    expect(
      slotsHint({
        expectedTeams: 5,
        expectedTeamsPrograms: { set: 1, total: 2 },
        publishedTeamSlots: 2,
      })
    ).toBe(
      "5 expected across 1 of 2 programs with a value set, 3 short against that"
    );
  });
});
