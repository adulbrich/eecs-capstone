import loadHighs, { type Highs } from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertValidPlacement,
  input,
  project,
  student,
  termFixture,
} from "#/lib/__tests__/placement-fixtures";
import { solvePlacement } from "#/lib/placement/solve";
import type { PlacementInput } from "#/lib/placement/types";

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const small = { minStudents: 1, maxStudents: 2 };

/**
 * The best objective any valid placement reaches, found by trying every
 * placement of every student on every team they may join. Written from the
 * rules, not from the model, so it checks the model rather than restating it.
 */
function bruteForceOptimum({ projects, students, parameters }: PlacementInput) {
  const teams = projects.flatMap((p) =>
    Array.from({ length: p.maxTeams }, (_, t) => ({ project: p, team: t + 1 }))
  );
  const options = students.map((s) =>
    teams.filter((t) => s.bids.some((b) => b.projectKey === t.project.key))
  );
  const weight = (i: number, key: string) => {
    const bid = students[i].bids.find((b) => b.projectKey === key);
    const w = bid ? (parameters.rankWeights[bid.priority - 1] ?? 0) : 0;
    const p = projects.find((x) => x.key === key);
    return Math.round(w * (p?.weightMultiplier ?? 1));
  };
  const eligible = (key: string) =>
    options.filter((o) => o.some((t) => t.project.key === key)).length;
  let best = Number.NEGATIVE_INFINITY;
  const chosen: (typeof teams)[number][] = [];
  const visit = (i: number) => {
    if (i === students.length) {
      const sizes = new Map<(typeof teams)[number], number>();
      for (const t of chosen) {
        sizes.set(t, (sizes.get(t) ?? 0) + 1);
      }
      for (const n of sizes.values()) {
        if (n < parameters.minStudents || n > parameters.maxStudents) {
          return;
        }
      }
      for (const p of projects) {
        const formed = [...sizes.keys()].some((t) => t.project === p);
        const required =
          parameters.requireOneTeamPerProject &&
          p.maxTeams > 0 &&
          eligible(p.key) >= parameters.minStudents;
        if (required && !formed) {
          return;
        }
      }
      const total = chosen.reduce(
        (sum, t, s) => sum + weight(s, t.project.key),
        0
      );
      best = Math.max(best, total);
      return;
    }
    for (const t of options[i]) {
      chosen.push(t);
      visit(i + 1);
      chosen.pop();
    }
  };
  visit(0);
  return best;
}

describe("solvePlacement", () => {
  it.each([
    [1, true],
    [2, true],
    [3, false],
    [4, false],
  ])(
    "matches a brute-force optimum on a small fixture (seed %i, at least one team %s)",
    (seed, requireOneTeamPerProject) => {
      const fixture = termFixture({
        studentCount: 7,
        projectCount: 4,
        twoTeamProjects: 1,
        bidsPerStudent: 3,
        seed,
      });
      const small7: PlacementInput = {
        ...fixture,
        parameters: {
          ...fixture.parameters,
          ...small,
          maxStudents: 3,
          requireOneTeamPerProject,
        },
      };
      const result = solvePlacement(highs, small7);
      expect(result.status).toBe("optimal");
      assertValidPlacement(small7, result.placements);
      expect(result.placements).toHaveLength(7);
      expect(result.objective).toBe(bruteForceOptimum(small7));
    }
  );

  it("solves a term-sized fixture to optimal well inside the time limit", () => {
    const fixture = termFixture();
    const started = performance.now();
    const result = solvePlacement(highs, fixture);
    const seconds = (performance.now() - started) / 1000;
    expect(result.status).toBe("optimal");
    expect(result.unplaced).toEqual([]);
    expect(result.placements).toHaveLength(150);
    assertValidPlacement(fixture, result.placements);
    expect(seconds).toBeLessThan(fixture.parameters.timeLimitSeconds / 3);
  });

  it("honours a pin to a project the student did not bid on", () => {
    const fixture = input(
      [project("A"), project("B")],
      [student("pat@example.edu", ["A"], { pin: "B" })],
      small
    );
    const result = solvePlacement(highs, fixture);
    expect(result.placements).toEqual([
      { email: "pat@example.edu", projectKey: "B", team: 1, priority: null },
    ]);
  });

  it("reports a pin that leaves its project short of its minimum as infeasible", () => {
    const fixture = input(
      [project("A"), project("B")],
      [
        ...["a", "b", "c", "d"].map((n) => student(`${n}@example.edu`, ["A"])),
        student("e@example.edu", ["A"], { pin: "B" }),
      ]
    );
    const result = solvePlacement(highs, fixture);
    expect(result.status).toBe("infeasible");
    expect(result.placements).toEqual([]);
    expect(result.diagnostics.pinnedProjectsBelowMin).toEqual(["B"]);
  });

  it("leaves a student who bid only on a dropped project unplaced and places the rest", () => {
    const fixture = input(
      [project("A", { maxTeams: 0 }), project("B")],
      [
        student("solo@example.edu", ["A"]),
        student("x@example.edu", ["B"]),
        student("y@example.edu", ["B"]),
      ],
      small
    );
    const result = solvePlacement(highs, fixture);
    expect(result.status).toBe("optimal");
    expect(result.unplaced).toEqual([
      { email: "solo@example.edu", reason: "no_eligible_project" },
    ]);
    expect(result.placements.map((p) => p.email).sort()).toEqual([
      "x@example.edu",
      "y@example.edu",
    ]);
  });

  it("leaves a student pinned to a dropped project unplaced", () => {
    const fixture = input(
      [project("A", { maxTeams: 0 }), project("B")],
      [student("pat@example.edu", ["B"], { pin: "A" })],
      small
    );
    expect(solvePlacement(highs, fixture).unplaced).toEqual([
      { email: "pat@example.edu", reason: "pinned_to_dropped_project" },
    ]);
  });

  it("moves students off a project whose weight multiplier deprioritises it", () => {
    const students = [
      student("x@example.edu", ["A", "B"]),
      student("y@example.edu", ["A", "B"]),
    ];
    const plain = solvePlacement(
      highs,
      input([project("A"), project("B")], students, {
        ...small,
        requireOneTeamPerProject: false,
      })
    );
    expect(plain.placements.map((p) => p.projectKey)).toEqual(["A", "A"]);
    const scaled = solvePlacement(
      highs,
      input(
        [project("A", { weightMultiplier: 0.25 }), project("B")],
        students,
        {
          ...small,
          requireOneTeamPerProject: false,
        }
      )
    );
    expect(scaled.placements.map((p) => p.projectKey)).toEqual(["B", "B"]);
  });

  it("forms a team the unconstrained optimum would skip when every project needs one", () => {
    const fixture = (requireOneTeamPerProject: boolean) =>
      input(
        [project("A"), project("B")],
        [
          student("x@example.edu", ["A", "B"]),
          student("y@example.edu", ["A", "B"]),
        ],
        { ...small, requireOneTeamPerProject }
      );
    const free = solvePlacement(highs, fixture(false));
    expect(free.placements.some((p) => p.projectKey === "B")).toBe(false);
    const required = solvePlacement(highs, fixture(true));
    expect(required.placements.map((p) => p.projectKey).sort()).toEqual([
      "A",
      "B",
    ]);
  });

  it("places a student with no bids on any project when unranked placement is allowed", () => {
    const fixture = (allowUnranked: boolean) =>
      input([project("A")], [student("pat@example.edu", [])], {
        ...small,
        allowUnranked,
      });
    expect(solvePlacement(highs, fixture(false)).unplaced).toHaveLength(1);
    expect(solvePlacement(highs, fixture(true)).placements).toEqual([
      { email: "pat@example.edu", projectKey: "A", team: 1, priority: null },
    ]);
  });

  it("returns an empty optimal result when nobody can be placed", () => {
    const result = solvePlacement(highs, input([project("A")], []));
    expect(result.status).toBe("optimal");
    expect(result.placements).toEqual([]);
  });
});
