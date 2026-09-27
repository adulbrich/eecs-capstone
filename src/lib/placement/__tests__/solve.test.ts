import loadHighs, { type Highs } from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertValidPlacement,
  input,
  project,
  rosterStudent,
  student,
  termFixture,
} from "#/lib/placement/__tests__/fixtures";
import { solvePlacement } from "#/lib/placement/solve";
import type { PlacementInput, PlacementResult } from "#/lib/placement/types";

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
    // Above HiGHS's own 30 s limit, so a slow run fails on the assertion
    // rather than on Vitest's default 5 s (docs/QUIRKS.md, Vitest).
  }, 60_000);

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

  describe("roster students who did not answer the survey (#666)", () => {
    it("places one with unranked placement off", () => {
      const result = solvePlacement(
        highs,
        input([project("A")], [rosterStudent("kim@example.edu")], {
          ...small,
          allowUnranked: false,
        })
      );
      expect(result.unplaced).toEqual([]);
      expect(result.placements).toEqual([
        { email: "kim@example.edu", projectKey: "A", team: 1, priority: null },
      ]);
    });

    it("forms a team two bidders could not reach the minimum of alone", () => {
      const students = [
        student("b1@example.edu", ["A", "B"]),
        student("b2@example.edu", ["A", "B"]),
        student("b3@example.edu", ["B"]),
        student("b4@example.edu", ["B"]),
        student("b5@example.edu", ["B"]),
      ];
      const projects = [project("A"), project("B", { maxStudents: 5 })];
      const parameters = { minStudents: 3, maxStudents: 4 };
      const without = solvePlacement(
        highs,
        input(projects, students, parameters)
      );
      expect(without.placements.every((p) => p.projectKey === "B")).toBe(true);

      const fixture = input(
        projects,
        [...students, rosterStudent("kim@example.edu")],
        parameters
      );
      const result = solvePlacement(highs, fixture);
      assertValidPlacement(fixture, result.placements);
      expect(
        result.placements
          .filter((p) => p.projectKey === "A")
          .map((p) => p.email)
          .sort()
      ).toEqual(["b1@example.edu", "b2@example.edu", "kim@example.edu"]);
    });

    it("leans toward the project with the fewest bids", () => {
      // The same three projects twice, with the bids turned around, so the
      // answer cannot come from column order alone.
      const placeKim = (bids: Record<string, string[]>) => {
        const fixture = input(
          [project("A"), project("B"), project("C")],
          [
            ...Object.entries(bids).map(([email, keys]) =>
              student(email, keys)
            ),
            rosterStudent("kim@example.edu"),
          ],
          { minStudents: 1, maxStudents: 3, requireOneTeamPerProject: false }
        );
        return solvePlacement(highs, fixture).placements.find(
          (p) => p.email === "kim@example.edu"
        )?.projectKey;
      };
      expect(
        placeKim({
          "x1@example.edu": ["A"],
          "x2@example.edu": ["A"],
          "x3@example.edu": ["B"],
        })
      ).toBe("C");
      expect(
        placeKim({
          "x1@example.edu": ["C"],
          "x2@example.edu": ["C"],
          "x3@example.edu": ["B"],
        })
      ).toBe("A");
    });

    it("does not make a project nobody bid on required", () => {
      // A needs all five students. Were Z required, the two roster
      // students would have to form it, and A could not fill.
      const fixture = input(
        [project("A"), project("Z", { minStudents: 2, maxStudents: 2 })],
        [
          student("a1@example.edu", ["A"]),
          student("a2@example.edu", ["A"]),
          student("a3@example.edu", ["A"]),
          rosterStudent("kim@example.edu"),
          rosterStudent("lou@example.edu"),
        ],
        { minStudents: 5, maxStudents: 5, requireOneTeamPerProject: true }
      );
      const result = solvePlacement(highs, fixture);
      expect(result.status).toBe("optimal");
      expect(result.placements.every((p) => p.projectKey === "A")).toBe(true);
    });

    it("never costs a bidder a point, and reports the bids' own score", () => {
      const term = termFixture({
        studentCount: 20,
        projectCount: 8,
        twoTeamProjects: 2,
        bidsPerStudent: 3,
      });
      // Room to spare, so the roster students displace nobody.
      const fixture: PlacementInput = {
        ...term,
        parameters: {
          ...term.parameters,
          minStudents: 1,
          maxStudents: 4,
          requireOneTeamPerProject: false,
        },
      };
      const base = solvePlacement(highs, fixture);
      const withRoster: PlacementInput = {
        ...fixture,
        students: [
          ...fixture.students,
          rosterStudent("kim@example.edu"),
          rosterStudent("lou@example.edu"),
          rosterStudent("max@example.edu"),
        ],
      };
      const result = solvePlacement(highs, withRoster);
      expect(base.status).toBe("optimal");
      expect(result.status).toBe("optimal");
      assertValidPlacement(withRoster, result.placements);
      expect(result.placements).toHaveLength(23);
      expect(result.objective).toBe(base.objective);
    });
  });

  it("fills a project added from the roster with its pre-approved students only (#670)", () => {
    const fixture = input(
      [
        project("A", { maxStudents: 5 }),
        project("roster:lab", {
          maxTeams: 1,
          minStudents: 1,
          maxStudents: 2,
          fromRoster: true,
        }),
      ],
      [
        student("a1@example.edu", ["A"]),
        student("a2@example.edu", ["A"]),
        student("cy@example.edu", ["A"], {
          pin: "roster:lab",
          preApproved: true,
        }),
        {
          ...rosterStudent("kim@example.edu"),
          pin: "roster:lab",
          preApproved: true,
        },
        rosterStudent("lou@example.edu"),
      ],
      { minStudents: 1, maxStudents: 4, allowUnranked: true }
    );
    const result = solvePlacement(highs, fixture);
    expect(result.status).toBe("optimal");
    expect(
      result.placements
        .filter((p) => p.projectKey === "roster:lab")
        .map((p) => p.email)
        .sort()
    ).toEqual(["cy@example.edu", "kim@example.edu"]);
  });

  it("reports a run the time limit stopped before any placement was found", () => {
    const fixture = termFixture();
    const result = solvePlacement(highs, {
      ...fixture,
      parameters: { ...fixture.parameters, timeLimitSeconds: 0 },
    });
    expect(result.status).toBe("time_limit");
    expect(result.placements).toEqual([]);
  });

  it("returns the best placement and its gap when the time limit stops a run", () => {
    // A real solve that stops with an incumbent but short of optimal depends
    // on timing, so this drives the same branch through a stand-in model.
    const stub = {
      ...highs,
      withModel: (
        _data: unknown,
        operation: (m: unknown) => PlacementResult
      ): PlacementResult =>
        operation({
          options: { set: () => undefined },
          run: () => undefined,
          getModelStatus: () => highs.constants.modelStatus.timeLimit,
          info: {
            get: (name: string) =>
              name === "primal_solution_status"
                ? highs.constants.solutionStatus.feasible
                : 0.04,
          },
          getSolution: () => ({ colValue: [1, 1] }),
          getObjectiveValue: () => 100,
        }),
    } as unknown as Highs;
    const result = solvePlacement(
      stub,
      input([project("A")], [student("pat@example.edu", ["A"])], small)
    );
    expect(result).toMatchObject({
      status: "time_limit",
      gap: 0.04,
      objective: 100,
      placements: [
        { email: "pat@example.edu", projectKey: "A", team: 1, priority: 1 },
      ],
    });
  });

  it("returns an error status instead of throwing when HiGHS rejects the model", () => {
    const result = solvePlacement(
      highs,
      input([project("A")], [student("pat@example.edu", ["A"])], {
        ...small,
        rankWeights: [Number.NaN],
      })
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/colCost/);
  });

  it("returns an empty optimal result when nobody can be placed", () => {
    const result = solvePlacement(highs, input([project("A")], []));
    expect(result.status).toBe("optimal");
    expect(result.placements).toEqual([]);
  });
});
