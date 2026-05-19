import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const projectInputSchema = z.object({
  id: z.string().uuid().optional(),
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
  imageUrl: z.string().max(500).nullable().optional().or(z.literal("")),
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
    const { createProjectForCurrentUser } = await import(
      "./_internal/projects"
    );
    return createProjectForCurrentUser(data);
  });

export const updateProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateProjectSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateProjectForCurrentUser } = await import(
      "./_internal/projects"
    );
    return updateProjectForCurrentUser(data);
  });

export const submitProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(data.id, "submitted", data.comment);
  });

export const returnToDraft = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(data.id, "draft", data.comment);
  });

export const requestChanges = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "changes_requested",
      data.comment,
    );
  });

export const approveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(data.id, "approved", data.comment);
  });

export const publishProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(data.id, "published", data.comment);
  });

export const archiveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(data.id, "archived", data.comment);
  });

export const restoreArchived = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(data.id, "published", data.comment);
  });

export const softDeleteProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const { softDeleteProjectForCurrentUser } = await import(
      "./_internal/projects"
    );
    return softDeleteProjectForCurrentUser(data.id);
  });

export const restoreProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const { restoreProjectForCurrentUser } = await import(
      "./_internal/projects"
    );
    return restoreProjectForCurrentUser(data.id);
  });

export const hardDeleteProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idOnlySchema.parse(data))
  .handler(async ({ data }) => {
    const { hardDeleteProjectForCurrentUser } = await import(
      "./_internal/projects"
    );
    return hardDeleteProjectForCurrentUser(data.id);
  });
