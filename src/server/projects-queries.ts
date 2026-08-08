import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Re-exported so components can type the shape `getProposerForEdit` returns
// without importing server internals. A type-only export; `verbatimModuleSyntax`
// erases it entirely, so it pulls no runtime code into any bundle. Mirrors how
// `src/server/inventory.ts` re-exports its staff detail types.
export type { ProposerForEdit } from "./_internal/projects-queries";

const STATUS_FILTER_VALUES = [
  "all",
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "published",
  "archived",
] as const;

const myProjectsSchema = z.object({
  status: z.enum(STATUS_FILTER_VALUES).default("all"),
});

const adminListSchema = z.object({
  status: z.enum(STATUS_FILTER_VALUES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
  program: z.string().uuid().nullable().default(null),
  // Better Auth user ids are text, not UUIDs, so this cannot be `.uuid()`.
  proposer: z.string().max(255).nullable().default(null),
  q: z.string().max(200).default(""),
});

const projectIdSchema = z.object({ id: z.string().uuid() });

export const listMyProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => myProjectsSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listMyProjectsImpl } = await import("./_internal/projects-queries");
    return listMyProjectsImpl(data);
  });

export const listAdminProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => adminListSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listAdminProjectsImpl } = await import(
      "./_internal/projects-queries"
    );
    return listAdminProjectsImpl(data);
  });

export const exportAdminProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => adminListSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { exportAdminProjectsImpl } = await import(
      "./_internal/projects-queries"
    );
    return exportAdminProjectsImpl(data);
  });

export const getProject = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { getProjectImpl } = await import("./_internal/projects-queries");
    return getProjectImpl(data);
  });

export const getProposerForEdit = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { getProposerForEditImpl } = await import(
      "./_internal/projects-queries"
    );
    return getProposerForEditImpl(data);
  });

export const listProjectEditLog = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { listProjectEditLogImpl } = await import(
      "./_internal/projects-queries"
    );
    return listProjectEditLogImpl(data);
  });

export const listProjectComments = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { listProjectCommentsImpl } = await import(
      "./_internal/projects-queries"
    );
    return listProjectCommentsImpl(data);
  });
