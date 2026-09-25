import { type SQL, sql } from "drizzle-orm";
import { projects, user } from "#/db/schema";
import type { ProjectProgram } from "#/lib/project-visibility";

/**
 * `"projects"."id"`, written out rather than interpolated as a column.
 *
 * Drizzle qualifies a column with its table only when the query has a
 * join, so interpolating `projects.id` renders a bare `"id"` on a
 * single-table select. Inside the correlated subqueries below that bare
 * name resolves against the subquery's own tables first: `categories c`
 * and `programs pr` both have an `id`, so the predicate silently compares
 * the wrong two columns and the aggregate comes back empty with no error
 * anywhere. It stayed hidden until #462 only because every consumer
 * happened to join `programs`, which qualified everything.
 *
 * Every consumer that selects from `projects` under that name gets the
 * right reference whether or not the outer query joins anything. A query
 * that aliases the table instead passes its own reference in; the
 * oldest-wait query in `analytics.ts` is the one that does.
 */
const OUTER_PROJECT_ID = sql.raw('"projects"."id"');

/** Same trap, same fix: `user` could grow a column of this name. */
const OUTER_MENTOR_EMAIL = sql.raw('"projects"."mentor_email"');

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
  WHERE pc.project_id = ${OUTER_PROJECT_ID}
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
  WHERE pc.project_id = ${OUTER_PROJECT_ID}
)`;

/**
 * The programs the project runs in, ordered by course id, as the badges and
 * the table column render them. Correlated rather than joined for the same
 * reason as the categories above: a join would multiply project rows by
 * their program count.
 *
 * The three parts stay separate keys. The listings render `courseId` alone
 * and the detail badge renders both halves, so pre-joining them into one
 * label here would lose a renderer's half of the answer.
 */
export const projectProgramsList = sql<ProjectProgram[]>`coalesce((
  SELECT json_agg(json_build_object('id', pr.id, 'courseId', pr.course_id, 'courseName', pr.course_name) ORDER BY pr.course_id)
  FROM project_programs pp
  JOIN programs pr ON pr.id = pp.program_id
  WHERE pp.project_id = ${OUTER_PROJECT_ID}
), '[]'::json)`;

/**
 * The same programs as one `; `-separated string of course ids, for the
 * shared table column and the staff CSV export, whose cell is text. Course
 * ids alone: a spreadsheet loses the course names, and the course id is
 * what staff sort and pivot on. The separator matches the categories cell
 * beside it, and is not a comma so a CSV cell cannot split on a value.
 */
export const projectProgramsText = sql<string | null>`(
  SELECT string_agg(pr.course_id, '; ' ORDER BY pr.course_id)
  FROM project_programs pp
  JOIN programs pr ON pr.id = pp.program_id
  WHERE pp.project_id = ${OUTER_PROJECT_ID}
)`;

/**
 * "This project runs in that program", as a filter predicate. An any-match:
 * the `?program=` filter stays single-valued, and a project shared between
 * two programs answers to both (#462).
 *
 * `exists` rather than a join, for the same fan-out reason as the aggregates
 * above, and so the predicate composes into a scope array beside plain
 * column comparisons.
 */
export function runsInProgram(
  programId: string,
  outerProjectId: SQL = OUTER_PROJECT_ID
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM project_programs pp
    WHERE pp.project_id = ${outerProjectId} AND pp.program_id = ${programId}
  )`;
}

/**
 * "This project runs in at least one program that one runs in", the
 * similar-projects list's scope (#614). A project with no programs shares
 * none, so it matches nothing and nothing matches it.
 */
export function sharesAProgramWith(
  projectId: string,
  outerProjectId: SQL = OUTER_PROJECT_ID
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM project_programs pp
    JOIN project_programs viewed ON viewed.program_id = pp.program_id
    WHERE pp.project_id = ${outerProjectId} AND viewed.project_id = ${projectId}
  )`;
}

/**
 * The admin Program filter's `none` state: a project nobody has filed yet,
 * which is a staff to-do. A project whose only program was deleted lands
 * here too, since the join row is `on delete cascade`.
 */
export const inNoProgram: SQL = sql`NOT EXISTS (
  SELECT 1 FROM project_programs pp WHERE pp.project_id = ${OUTER_PROJECT_ID}
)`;

/**
 * How many programs a project runs in, for the analytics footnote, which
 * asks "more than one" and never for the list. The staff panel's warning
 * counts the array it already has rather than asking SQL again.
 */
export const projectProgramCount = sql<number>`(
  SELECT count(*)::int FROM project_programs pp
  WHERE pp.project_id = ${OUTER_PROJECT_ID}
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
  WHERE lower(${user.email}) = lower(${OUTER_MENTOR_EMAIL})
  LIMIT 1
)`;

/**
 * Column projection shared by every query that feeds the project card and
 * the public table: the public listing, "my projects" and "my bookmarks".
 * The programs come from a correlated subquery, so no caller joins anything
 * to use it.
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
  // agreement is involved before applying.
  requiresNdaIp: projects.requiresNdaIp,
  teamsSupported: projects.teamsSupported,
  // Public by design: a student needs to see a closed roster before they
  // invest in an application. See #72.
  acceptingApplicants: projects.acceptingApplicants,
  status: projects.status,
  imageUrl: projects.imageUrl,
  // Manually entered and publicly visible, unlike proposerEmail.
  contactEmail: projects.contactEmail,
  contactName: projects.contactName,
  updatedAt: projects.updatedAt,
  programs: projectProgramsList,
  categories: projectCategoriesList,
  // Public by design. Nothing about the mentor is: not the address, since
  // #336 not the name either, which `adminProjectSummarySelect` adds back on
  // the staff path, and since #402 no derived flag. See the note on
  // proposerEmail there for the same distinction.
  studentProposed: projects.studentProposed,
};

/**
 * The staff projection: the public one plus proposer identity and the
 * lifecycle dates. Proposer identity is staff information and is what keeps
 * this separate from `projectSummarySelect`. The CSV export reads it whole;
 * the staff table reads `adminProjectListSelect`, which drops its prose.
 *
 * Join `user` (on `projects.proposerId`) before using it.
 */
export const adminProjectSummarySelect = {
  ...projectSummarySelect,
  // Staff only: the mentor address and the name it resolves to, for the
  // staff list, its search and the CSV export. The name left the public
  // projection in #336; the address joined it here in #617, because a
  // mentor recorded before they have an account resolves to no name and
  // would otherwise read the same as no mentor at all.
  mentorEmail: projects.mentorEmail,
  mentorName: mentorNameSql,
  createdAt: projects.createdAt,
  deletedAt: projects.deletedAt,
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

// The six prose columns the staff table never renders. Named with a leading
// underscore so the rest binding below is the only thing read, and bound
// here rather than in an exported destructure, which would export them too.
const {
  description: _description,
  problemStatement: _problemStatement,
  objectives: _objectives,
  minQualifications: _minQualifications,
  prefQualifications: _prefQualifications,
  licenseRestrictions: _licenseRestrictions,
  ...adminProjectListColumns
} = adminProjectSummarySelect;

/**
 * The staff table's projection: `adminProjectSummarySelect` without the six
 * prose columns. The table renders none of them, the search runs in SQL
 * rather than in the browser (against the tsvector, which covers five of them;
 * `licenseRestrictions` was never searched), and the CSV export reads its own
 * wider projection, so carrying them only cost payload: about 1 KB a row,
 * every row, on every visit to an unpaged table (#482).
 *
 * Derived from the staff projection rather than trimming it, because the
 * export and the mentorship tests read that one whole. Join `user` (on
 * `projects.proposerId`) before using it, same as the projection it narrows.
 */
export const adminProjectListSelect = adminProjectListColumns;
