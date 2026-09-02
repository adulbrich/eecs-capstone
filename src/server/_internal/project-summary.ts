import { sql } from "drizzle-orm";
import { programs, projects, user } from "#/db/schema";

export interface ProjectCategory {
  id: string;
  name: string;
  /** Nullable in the schema; `json_build_object` passes the null through. */
  type: string | null;
}

/**
 * The project's categories, ordered by type then name, as the chips render
 * them. Correlated rather than joined: a join would multiply project rows by
 * their category count and need a GROUP BY over the whole projection.
 */
export const projectCategoriesList = sql<ProjectCategory[]>`coalesce((
  SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'type', c.type) ORDER BY c.type, c.name)
  FROM project_categories pc
  JOIN categories c ON c.id = pc.category_id
  WHERE pc.project_id = ${projects.id}
), '[]'::json)`;

/**
 * The same categories as one `; `-separated string of names, for the staff
 * CSV export, whose cell is text. Same order, so the file reads like the
 * chips.
 */
export const projectCategoriesText = sql<string | null>`(
  SELECT string_agg(c.name, '; ' ORDER BY c.type, c.name)
  FROM project_categories pc
  JOIN categories c ON c.id = pc.category_id
  WHERE pc.project_id = ${projects.id}
)`;

/**
 * The mentor, resolved at read time. A correlated subquery rather than a join
 * so the four consumers of `projectSummarySelect` pick it up without each
 * adding a join, same as `categories` in the admin export. Case-insensitive
 * on purpose, and therefore not on the `user.email` index; at capstone scale
 * that costs nothing and it is the same trade `claim-projects.ts` makes.
 *
 * `LIMIT 1` is belt and braces: `user.email` is unique, but only byte-wise.
 */
export const mentorNameSql = sql<string | null>`(
  SELECT ${user.name} FROM ${user}
  WHERE lower(${user.email}) = lower(${projects.mentorEmail})
  LIMIT 1
)`;

/**
 * "Needs a mentor" is derived, never stored, so it cannot drift from the
 * mentor being assigned. It lives here rather than in the client because the
 * public payload does not carry `mentorEmail`: without this flag a client
 * could not tell "no mentor" from "a mentor is lined up who has not signed up
 * yet", and the second must show nothing rather than "Seeking mentor".
 */
export const seekingMentorSql = sql<boolean>`(${projects.studentProposed} AND ${projects.mentorEmail} IS NULL)`;

/**
 * Column projection shared by every query that feeds the project card and
 * the public table: the public listing, "my projects" and "my bookmarks".
 * Join `programs` via leftJoin before using it so the program columns
 * resolve (null for projects without a program).
 *
 * What may be in here is decided by `projectDetailView` and pinned by a
 * key-set test; `docs/QUIRKS.md` ("The listing projection is bounded by
 * projectDetailView") is the one place that rule is written out.
 */
export const projectSummarySelect = {
  id: projects.id,
  title: projects.title,
  description: projects.description,
  problemStatement: projects.problemStatement,
  objectives: projects.objectives,
  minQualifications: projects.minQualifications,
  prefQualifications: projects.prefQualifications,
  url: projects.url,
  licenseRestrictions: projects.licenseRestrictions,
  // Public by design, see projectDetailView: a student needs to know an
  // agreement is involved before bidding.
  requiresNdaIp: projects.requiresNdaIp,
  teamsSupported: projects.teamsSupported,
  status: projects.status,
  imageUrl: projects.imageUrl,
  // Manually entered and publicly visible, unlike proposerEmail.
  contactEmail: projects.contactEmail,
  contactName: projects.contactName,
  updatedAt: projects.updatedAt,
  programCourseId: programs.courseId,
  programCourseName: programs.courseName,
  categories: projectCategoriesList,
  // Public by design, all three. The address itself is not here and must not
  // be: it is staff information, see `adminProjectSummarySelect`'s note on
  // proposerEmail for the same distinction.
  studentProposed: projects.studentProposed,
  seekingMentor: seekingMentorSql,
  mentorName: mentorNameSql,
};

/**
 * The staff listing's projection: the public one plus proposer identity and
 * the lifecycle dates. Proposer identity is staff information and is what
 * keeps this separate from `projectSummarySelect`.
 *
 * Join `programs` and `user` (on `projects.proposerId`) before using it.
 */
export const adminProjectSummarySelect = {
  ...projectSummarySelect,
  createdAt: projects.createdAt,
  deletedAt: projects.deletedAt,
  programId: projects.programId,
  // `proposerId IS NULL AND proposerEmail IS NOT NULL` is a normal steady
  // state, not just a deleted-account edge case: staff can name a proposer by
  // email who has no account yet, and the project links up automatically the
  // first time that person signs in. Until then, `user.email` from the join
  // resolves to null, so fall back to the stored snapshot column, same as
  // `getProposerForEditAs` does. Do not simplify this to `user.email`.
  proposerEmail: sql<
    string | null
  >`coalesce(${user.email}, ${projects.proposerEmail})`,
  proposerId: projects.proposerId,
  proposerName: user.name,
  publishedAt: projects.publishedAt,
};
