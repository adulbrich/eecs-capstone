import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commentContent } from "#/lib/comment-content";
import { SEND_EMAIL_FIELD } from "./send-email-field";

const addCommentSchema = z.object({
  projectId: z.string().uuid(),
  content: commentContent,
  parentId: z.string().uuid().nullable().optional(),
  isInternal: z.boolean().default(false),
  ...SEND_EMAIL_FIELD,
});

/**
 * Content only. `isInternal` is absent rather than optional: the flag is fixed
 * once posted, because flipping it would pretend to retract text that has
 * already been emailed, or expose a staff aside whose replies inherited their
 * internal flag at write time (#503).
 *
 * No `SEND_EMAIL_FIELD`: an edit sends no email, so there is no skip to offer.
 */
const updateCommentSchema = z.object({
  commentId: z.string().uuid(),
  content: commentContent,
});

export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

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

export const updateComment = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateCommentSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateCommentForCurrentUser } = await import(
      "./_internal/comments"
    );
    return updateCommentForCurrentUser(data);
  });
