import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type {
  ImprovableField,
  ReviewResult,
} from "#/lib/project-review-fields";
import { canEditProject } from "#/lib/project-visibility";
import { runProjectReview } from "./project-review-core";

export type AuthUser = { id: string; role?: string | null | undefined };

export type ReviewProjectInput = {
  projectId: string;
  fields: Partial<Record<ImprovableField, string>>;
};

export async function reviewProjectAs(
  viewer: AuthUser,
  input: ReviewProjectInput,
): Promise<ReviewResult> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  if (!canEditProject(project, { id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
  return runProjectReview(input.fields);
}

export async function reviewProjectForCurrentUser(
  input: ReviewProjectInput,
): Promise<ReviewResult> {
  const viewer = await requireUser();
  return reviewProjectAs(viewer, input);
}
