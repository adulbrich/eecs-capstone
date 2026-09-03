import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export type ScopeAssessmentInput = z.infer<typeof projectIdSchema>;

export const getScopeAssessment = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { getScopeAssessmentForCurrentUser } = await import(
      "./_internal/scope-assessment"
    );
    return getScopeAssessmentForCurrentUser(data);
  });

export const assessProjectScope = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { assessProjectScopeForCurrentUser } = await import(
      "./_internal/scope-assessment"
    );
    return assessProjectScopeForCurrentUser(data);
  });
