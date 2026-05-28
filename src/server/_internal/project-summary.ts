import { programs, projects } from "#/db/schema";

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
