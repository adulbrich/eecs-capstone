import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Status } from "#/lib/project-workflow";

const STATUS_VALUES = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "published",
  "archived",
] as const;

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
  imageUrl: z.string().max(500).nullable().optional().or(z.literal("")),
  licenseRestrictions: z.string().max(1000).nullable().optional(),
  requiresNdaIp: z.boolean().optional(),
  isSponsored: z.boolean().optional(),
  programId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  proposerEmail: z
    .string()
    .email()
    .max(200)
    .nullable()
    .optional()
    .or(z.literal("")),
  teamsSupported: z.number().int().min(1).max(5).optional(),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

const updateProjectSchema = projectInputSchema.extend({
  id: z.string().uuid(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const mentorshipSchema = z.object({
  id: z.string().uuid(),
  // A string in transit, null only in the column: empty is the form clearing
  // the field, and the impl folds it to null. Same ceiling as contactEmail.
  mentorEmail: z.string().email().max(200).or(z.literal("")),
  studentProposed: z.boolean(),
});

export type MentorshipInput = z.infer<typeof mentorshipSchema>;

// Defaults true so a partial caller sends mail rather than silently swallowing
// it. Staff opt out per action from the transition dialog.
const SEND_EMAIL_FIELD = { sendEmail: z.boolean().default(true) };

const transitionInputSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(2000).optional(),
  ...SEND_EMAIL_FIELD,
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

export const updateProjectMentorship = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => mentorshipSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateProjectMentorshipForCurrentUser } = await import(
      "./_internal/projects"
    );
    return updateProjectMentorshipForCurrentUser(data);
  });

export const submitProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "submitted",
      data.comment,
      data.sendEmail
    );
  });

export const returnToDraft = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "draft",
      data.comment,
      data.sendEmail
    );
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
      data.sendEmail
    );
  });

export const approveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "approved",
      data.comment,
      data.sendEmail
    );
  });

export const publishProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "published",
      data.comment,
      data.sendEmail
    );
  });

export const archiveProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "archived",
      data.comment,
      data.sendEmail
    );
  });

export const restoreArchived = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => transitionInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      "published",
      data.comment,
      data.sendEmail
    );
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

const statusTransitionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUS_VALUES),
  comment: z.string().max(2000).optional(),
  ...SEND_EMAIL_FIELD,
});

export const performTransition = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => statusTransitionSchema.parse(data))
  .handler(async ({ data }) => {
    const { performTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return performTransitionForCurrentUser(
      data.id,
      data.status as Status,
      data.comment,
      data.sendEmail
    );
  });

export const forceSetProjectStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => statusTransitionSchema.parse(data))
  .handler(async ({ data }) => {
    const { forceTransitionForCurrentUser } = await import(
      "./_internal/projects"
    );
    return forceTransitionForCurrentUser(
      data.id,
      data.status as Status,
      data.comment,
      data.sendEmail
    );
  });
