import { sql } from "drizzle-orm";
import { programs, projects, user } from "#/db/schema";

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
 * Column projection shared by every query that feeds the project
 * card/row components. Join `programs` via leftJoin before using it so
 * the program columns resolve (null for projects without a program).
 */
export const projectSummarySelect = {
  id: projects.id,
  title: projects.title,
  description: projects.description,
  status: projects.status,
  imageUrl: projects.imageUrl,
  contactName: projects.contactName,
  updatedAt: projects.updatedAt,
  programCourseId: programs.courseId,
  programCourseName: programs.courseName,
  // Public by design, all three. The address itself is not here and must not
  // be: it is staff information, see `adminProjectSummarySelect`'s note on
  // proposerEmail for the same distinction.
  studentProposed: projects.studentProposed,
  seekingMentor: seekingMentorSql,
  mentorName: mentorNameSql,
};

/**
 * The staff listing's projection. It deliberately does not widen
 * `projectSummarySelect`, which the public listing and "my projects" share:
 * proposer identity and contact email are staff information.
 *
 * Join `programs` and `user` (on `projects.proposerId`) before using it.
 */
export const adminProjectSummarySelect = {
  ...projectSummarySelect,
  contactEmail: projects.contactEmail,
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
  teamsSupported: projects.teamsSupported,
};
