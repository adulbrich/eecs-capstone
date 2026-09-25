import { describe, expect, it } from "vitest";
import { input, project, student } from "#/lib/placement/__tests__/fixtures";
import { buildPlacementModel } from "#/lib/placement/model";

describe("buildPlacementModel", () => {
  it("gives a dropped project no teams and each other project one per allowed team", () => {
    const model = buildPlacementModel(
      input(
        [
          project("A", { maxTeams: 0 }),
          project("B", { maxTeams: 2 }),
          project("C"),
        ],
        []
      )
    );
    expect(model.slots.map((s) => `${s.projectKey}${s.team}`)).toEqual([
      "B1",
      "B2",
      "C1",
    ]);
  });

  it("takes a project's own bounds over the page defaults", () => {
    const model = buildPlacementModel(
      input(
        [project("A", { minStudents: 1, maxStudents: 6 }), project("B")],
        []
      )
    );
    expect(model.slots.map(({ min, max }) => [min, max])).toEqual([
      [1, 6],
      [3, 4],
    ]);
  });

  it("weights a bid by its priority times the project's multiplier, rounded", () => {
    const model = buildPlacementModel(
      input(
        [project("A", { weightMultiplier: 0.25 }), project("B"), project("C")],
        [student("pat@example.edu", ["B", "A", "C", "D", "C"])],
        { rankWeights: [100, 85, 75] }
      )
    );
    const costs = Object.fromEntries(
      model.columns.flatMap((c) =>
        c.kind === "placement" ? [[model.slots[c.slot].projectKey, c.cost]] : []
      )
    );
    expect(costs).toEqual({ A: 21, B: 100, C: 75 });
  });

  it("reports more placeable students than seats", () => {
    const model = buildPlacementModel(
      input(
        [project("A")],
        ["a", "b", "c"].map((n) => student(`${n}@example.edu`, ["A"])),
        { minStudents: 1, maxStudents: 2 }
      )
    );
    expect(model.diagnostics.seatShortfall).toEqual({ students: 3, seats: 2 });
  });

  it("reports teams the at-least-one rule demands beyond the students there are", () => {
    const model = buildPlacementModel(
      input(
        [project("A"), project("B")],
        ["a", "b", "c"].map((n) => student(`${n}@example.edu`, [])),
        { allowUnranked: true, minStudents: 3 }
      )
    );
    expect(model.diagnostics.requiredSeatShortfall).toEqual({
      required: 6,
      students: 3,
    });
  });

  it("reports more pins on a project than it has seats", () => {
    const model = buildPlacementModel(
      input(
        [project("A"), project("B")],
        ["a", "b", "c"].map((n) =>
          student(`${n}@example.edu`, ["B"], { pin: "A" })
        ),
        { minStudents: 1, maxStudents: 2 }
      )
    );
    expect(model.diagnostics.pinOverflow).toEqual([
      { projectKey: "A", pinned: 3, seats: 2 },
    ]);
  });

  it("exempts a project too few students may join from the at-least-one rule", () => {
    const model = buildPlacementModel(
      input(
        [project("A"), project("B")],
        ["a", "b", "c"].map((n) => student(`${n}@example.edu`, ["A", "B"])),
        { minStudents: 3 }
      )
    );
    expect(model.diagnostics.projectsBelowMin).toEqual([]);
    const lonely = buildPlacementModel(
      input(
        [project("A"), project("B")],
        [
          ...["a", "b", "c"].map((n) => student(`${n}@example.edu`, ["A"])),
          student("d@example.edu", ["B"]),
        ],
        { minStudents: 3 }
      )
    );
    expect(lonely.diagnostics.projectsBelowMin).toEqual(["B"]);
    const atLeastOne = (m: typeof model) =>
      m.rows.filter(
        (r) => r.lower === 1 && r.upper === Number.POSITIVE_INFINITY
      ).length;
    expect(atLeastOne(model)).toBe(2);
    expect(atLeastOne(lonely)).toBe(1);
  });
});
