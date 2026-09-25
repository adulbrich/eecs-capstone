import {
  DEFAULT_PLACEMENT_PARAMETERS,
  type Placement,
  type PlacementInput,
  type PlacementParameters,
  type PlacementProject,
  type PlacementStudent,
} from "#/lib/placement/types";

// Every name, email and title here is invented. No real bid data is read or
// committed (#647).

export function project(
  key: string,
  overrides: Partial<PlacementProject> = {}
): PlacementProject {
  return {
    key,
    title: `Project ${key}`,
    maxTeams: 1,
    weightMultiplier: 1,
    ...overrides,
  };
}

/** A student who bid on `keys` in order, first choice first. */
export function student(
  email: string,
  keys: string[],
  overrides: Partial<PlacementStudent> = {}
): PlacementStudent {
  return {
    email,
    name: email.split("@")[0],
    bids: keys.map((projectKey, i) => ({
      projectKey,
      priority: i + 1,
      comment: `Why ${projectKey}`,
    })),
    ...overrides,
  };
}

export function input(
  projects: PlacementProject[],
  students: PlacementStudent[],
  parameters: Partial<PlacementParameters> = {}
): PlacementInput {
  return {
    projects,
    students,
    parameters: { ...DEFAULT_PLACEMENT_PARAMETERS, ...parameters },
  };
}

/**
 * A term-shaped fixture: `studentCount` students, `projectCount` projects,
 * the first `twoTeamProjects` of them allowed two teams, and `bidsPerStudent`
 * bids per student skewed toward the lower-numbered projects the way real bids bunch
 * on a few favourites. Seeded, so every run builds the same input.
 */
export function termFixture({
  studentCount = 150,
  projectCount = 45,
  twoTeamProjects = 5,
  bidsPerStudent = 6,
  seed = 7,
} = {}): PlacementInput {
  let state = seed;
  const random = () => {
    state = (state * 16_807) % 2_147_483_647;
    return state / 2_147_483_647;
  };
  const keys = Array.from(
    { length: projectCount },
    (_, i) => `P${String(i + 1).padStart(2, "0")}`
  );
  const popularity = keys.map((_, i) => 1 / (i + 3));
  const total = popularity.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = random() * total;
    for (let i = 0; i < keys.length; i++) {
      r -= popularity[i];
      if (r <= 0) {
        return keys[i];
      }
    }
    return keys.at(-1) as string;
  };
  const students = Array.from({ length: studentCount }, (_, i) => {
    const chosen = new Set<string>();
    while (chosen.size < Math.min(bidsPerStudent, projectCount)) {
      chosen.add(pick());
    }
    return student(`student${String(i + 1).padStart(3, "0")}@example.edu`, [
      ...chosen,
    ]);
  });
  return input(
    keys.map((key, i) =>
      project(key, { maxTeams: i < twoTeamProjects ? 2 : 1 })
    ),
    students
  );
}

/**
 * Throws with the first rule a placement breaks: a student placed twice, on a
 * project they may not join, on a dropped project, off their pin, or a team
 * outside its bounds or beyond the project's ceiling.
 */
export function assertValidPlacement(
  { projects, students, parameters }: PlacementInput,
  placements: Placement[]
) {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const teams = new Map<string, number>();
  for (const p of placements) {
    if (seen.has(p.email)) {
      throw new Error(`${p.email} is placed twice`);
    }
    seen.add(p.email);
    const s = students.find((x) => x.email === p.email);
    const proj = byKey.get(p.projectKey);
    if (s === undefined || proj === undefined || proj.maxTeams === 0) {
      throw new Error(`${p.email} is on a project that cannot take them`);
    }
    if (s.pin !== undefined && s.pin !== p.projectKey) {
      throw new Error(`${p.email} is off their pin`);
    }
    const bid = s.bids.some((b) => b.projectKey === p.projectKey);
    if (!(bid || s.pin || parameters.allowUnranked)) {
      throw new Error(`${p.email} is on a project they did not bid on`);
    }
    if (p.team > proj.maxTeams) {
      throw new Error(`${p.projectKey} forms team ${p.team}`);
    }
    const team = `${p.projectKey}#${p.team}`;
    teams.set(team, (teams.get(team) ?? 0) + 1);
  }
  for (const [team, size] of teams) {
    const proj = byKey.get(team.split("#")[0]) as PlacementProject;
    const min = proj.minStudents ?? parameters.minStudents;
    const max = proj.maxStudents ?? parameters.maxStudents;
    if (size < min || size > max) {
      throw new Error(`${team} has ${size} students, outside ${min} to ${max}`);
    }
  }
}
