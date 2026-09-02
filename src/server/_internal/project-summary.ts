import { sql } from "drizzle-orm";
import { programs, projects, user } from "#/db/schema";

/**
 * The project's category names in one string, `; ` separated and ordered by
 * type then name. Correlated rather than joined: a join would multiply
 * project rows by their category count and need a GROUP BY over the whole
 * projection.
 */
export const projectCategoriesList = sql<string | null>`(
  SELECT string_agg(c.name, '; ' ORDER BY c.type, c.name)
  FROM project_categories pc
  JOIN categories c ON c.id = pc.category_id
  WHERE pc.project_id = ${projects.id}
)`;

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
