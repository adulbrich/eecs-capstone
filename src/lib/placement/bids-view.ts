import type { PlacementStudent, WorkspaceProject } from "#/lib/placement/types";

/**
 * The Bids tab's per-project view (#671): every project with the students
 * who bid on it, so staff can judge a project's bidders by what they wrote
 * and pin one there before any run. Derived and never stored.
 */

export interface ProjectBidRow {
  avoid: string | undefined;
  comment: string;
  email: string;
  /** The one row of a project nobody bid on or is pinned to. */
  empty: boolean;
  /** Unique within the view: a project and a student, or an empty project. */
  id: string;
  name: string;
  /** The title of the project the student is pinned to, when it is not
   * this one. */
  pinnedElsewhere: string | null;
  pinnedHere: boolean;
  /** Pinned here by a pre-approval on the roster (#670). */
  preApproved: boolean;
  /** Null for a student pinned here without bidding on it. */
  priority: number | null;
  projectKey: string;
  projectTitle: string;
}

/**
 * One row per bid, plus one per student pinned to a project they did not
 * bid on, grouped by project title and ordered by priority within a
 * project, with any pin-only rows last. A project with neither gets one
 * empty row, so it shows rather than going missing. `students` should carry
 * the pins in effect: the file's, the roster's and the board's.
 */
export function projectBidRows(
  students: readonly PlacementStudent[],
  projects: readonly WorkspaceProject[]
): ProjectBidRow[] {
  const titles = new Map(projects.map((p) => [p.key, p.title]));
  const byProject = new Map<string, ProjectBidRow[]>(
    projects.map((p) => [p.key, []])
  );
  const add = (
    student: PlacementStudent,
    projectKey: string,
    priority: number | null,
    comment: string
  ) => {
    const rows = byProject.get(projectKey);
    if (rows === undefined) {
      return;
    }
    const pinnedHere = student.pin === projectKey;
    rows.push({
      id: `${projectKey}:${student.email}`,
      projectKey,
      projectTitle: titles.get(projectKey) ?? projectKey,
      email: student.email,
      name: student.name,
      avoid: student.avoid,
      priority,
      comment,
      pinnedHere,
      pinnedElsewhere:
        student.pin === undefined || pinnedHere
          ? null
          : (titles.get(student.pin) ?? student.pin),
      preApproved: pinnedHere && student.preApproved === true,
      empty: false,
    });
  };
  for (const student of students) {
    for (const bid of student.bids) {
      add(student, bid.projectKey, bid.priority, bid.comment);
    }
    const { pin } = student;
    if (pin !== undefined && !student.bids.some((b) => b.projectKey === pin)) {
      add(student, pin, null, "");
    }
  }
  const byName = (a: ProjectBidRow, b: ProjectBidRow) =>
    (a.name || a.email).localeCompare(b.name || b.email);
  return [...projects]
    .sort((a, b) => a.title.localeCompare(b.title))
    .flatMap((project) => {
      const rows = byProject.get(project.key) ?? [];
      if (rows.length === 0) {
        return [
          {
            id: `${project.key}:`,
            projectKey: project.key,
            projectTitle: project.title,
            email: "",
            name: "",
            avoid: undefined,
            priority: null,
            comment: "",
            pinnedHere: false,
            pinnedElsewhere: null,
            preApproved: false,
            empty: true,
          },
        ];
      }
      return rows.sort(
        (a, b) =>
          (a.priority ?? Number.POSITIVE_INFINITY) -
            (b.priority ?? Number.POSITIVE_INFINITY) || byName(a, b)
      );
    });
}
