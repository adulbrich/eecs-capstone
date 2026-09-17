import { describe, expect, it } from "vitest";
import { slotsHint } from "../analytics-copy";

describe("slotsHint", () => {
  it("says not set rather than comparing against zero", () => {
    expect(
      slotsHint({
        expectedTeams: null,
        expectedTeamsPrograms: { set: 0, total: 1 },
        publishedTeamSlots: 6,
        sharedProjects: 0,
      })
    ).toBe("Expected teams not set on the program");
    expect(
      slotsHint({
        expectedTeams: null,
        expectedTeamsPrograms: { set: 0, total: 3 },
        publishedTeamSlots: 6,
        sharedProjects: 0,
      })
    ).toBe("Expected teams not set on any program");
  });

  it("compares when every program in scope has a value", () => {
    expect(
      slotsHint({
        expectedTeams: 8,
        expectedTeamsPrograms: { set: 1, total: 1 },
        publishedTeamSlots: 6,
        sharedProjects: 0,
      })
    ).toBe("8 expected, 2 short");
    expect(
      slotsHint({
        expectedTeams: 5,
        expectedTeamsPrograms: { set: 2, total: 2 },
        publishedTeamSlots: 6,
        sharedProjects: 0,
      })
    ).toBe("5 expected, covered");
  });

  // A project in two programs contributes its whole teams_supported to each,
  // so the per program tiles stop summing to the global one. Staff read the
  // discrepancy here rather than filing it as a bug.
  it("says a shared project counts in full under each of its programs", () => {
    expect(
      slotsHint({
        expectedTeams: 8,
        expectedTeamsPrograms: { set: 1, total: 1 },
        publishedTeamSlots: 6,
        sharedProjects: 3,
      })
    ).toBe(
      "8 expected, 2 short; 3 projects run in more than one program and count in full under each"
    );
  });

  it("singularizes one shared project and appends to the not-set hint too", () => {
    expect(
      slotsHint({
        expectedTeams: null,
        expectedTeamsPrograms: { set: 0, total: 2 },
        publishedTeamSlots: 6,
        sharedProjects: 1,
      })
    ).toBe(
      "Expected teams not set on any program; 1 project runs in more than one program and counts in full under each"
    );
  });

  it("names a partial denominator instead of passing it off as the whole", () => {
    expect(
      slotsHint({
        expectedTeams: 5,
        expectedTeamsPrograms: { set: 1, total: 2 },
        publishedTeamSlots: 2,
        sharedProjects: 0,
      })
    ).toBe(
      "5 expected across 1 of 2 programs with a value set, 3 short against that"
    );
  });
});
