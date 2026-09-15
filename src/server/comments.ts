import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SEND_EMAIL_FIELD } from "./send-email-field";

const addCommentSchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
  isInternal: z.boolean().default(false),
  ...SEND_EMAIL_FIELD,
});

// The row fields only; the skip travels in `EmailOptions` (#379).
export type AddCommentInput = Omit<
  z.infer<typeof addCommentSchema>,
  "sendEmail"
>;

export const addComment = createServerFn({ method: "POST" })
  .validator((data: unknown) => addCommentSchema.parse(data))
  .handler(async ({ data }) => {
    const { addCommentForCurrentUser } = await import("./_internal/comments");
    return addCommentForCurrentUser(data);
  });
