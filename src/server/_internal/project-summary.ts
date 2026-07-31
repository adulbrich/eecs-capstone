import { programs, projects, user } from "#/db/schema";

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
  proposerEmail: user.email,
  proposerId: projects.proposerId,
  proposerName: user.name,
  publishedAt: projects.publishedAt,
  teamsSupported: projects.teamsSupported,
};
