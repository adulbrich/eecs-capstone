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
  .inputValidator((data: unknown) => addCommentSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { addCommentAs } = await import("./_internal/comments");
    const viewer = await requireUser();
    return addCommentAs(viewer, data);
  });
