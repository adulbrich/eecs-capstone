import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Status } from "#/lib/project-workflow";

const projectInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  problemStatement: z.string().max(5000).nullable().optional(),
  objectives: z.string().max(5000).nullable().optional(),
  minQualifications: z.string().max(2000).nullable().optional(),
  prefQualifications: z.string().max(2000).nullable().optional(),
  url: z.string().url().max(500).nullable().optional().or(z.literal("")),
  contactEmail: z
    .string()
    .email()
    .max(200)
    .nullable()
    .optional()
    .or(z.literal("")),
  contactName: z.string().max(200).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional().or(z.literal("")),
  licenseRestrictions: z.string().max(1000).nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

const updateProjectSchema = projectInputSchema.extend({
  id: z.string().uuid(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

const transitionInputSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(2000).optional(),
});

const idOnlySchema = z.object({ id: z.string().uuid() });

export const createProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => projectInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { createProjectAs } = await import("./_internal/projects");
    const viewer = await requireUser();
    return createProjectAs(viewer, data);
  });

export const updateProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateProjectSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { updateProjectAs } = await import("./_internal/projects");
    const viewer = await requireUser();
    return updateProjectAs(viewer, data);
  });

function makeTransition(target: Status) {
  return createServerFn({ method: "POST" })
    .inputValidator((data: unknown) => transitionInputSchema.parse(data))
    .handler(async ({ data }) => {
      const { requireUser } = await import("#/lib/_internal/auth-guards");
      const { performTransitionAs } = await import("./_internal/projects");
      const viewer = await requireUser();
      return performTransitionAs(viewer, data.id, target, data.comment);
    });
}

export const submitProject = makeTransition("submitted");
export const returnToDraft = makeTransition("draft");
export const requestChanges = makeTransition("changes_requested");
export const approveProject = makeTransition("approved");
export const publishProject = makeTransition("published");
export const archiveProject = makeTransition("archived");
export const restoreArchived = makeTransition("published");

export const softDeleteProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { softDeleteProjectAs } = await import("./_internal/projects");
    const viewer = await requireUser();
    return softDeleteProjectAs(viewer, data.id);
  });

export const restoreProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { restoreProjectAs } = await import("./_internal/projects");
    const viewer = await requireUser();
    return restoreProjectAs(viewer, data.id);
  });

export const hardDeleteProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { hardDeleteProjectAs } = await import("./_internal/projects");
    const viewer = await requireUser();
    return hardDeleteProjectAs(viewer, data.id);
  });
