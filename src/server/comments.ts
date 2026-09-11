import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const addCommentSchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
  isInternal: z.boolean().default(false),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;

export const addComment = createServerFn({ method: "POST" })
  .validator((data: unknown) => addCommentSchema.parse(data))
  .handler(async ({ data }) => {
    const { addCommentForCurrentUser } = await import("./_internal/comments");
    return addCommentForCurrentUser(data);
  });
