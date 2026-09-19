import { z } from "zod";

/**
 * A comment's body, in one spelling.
 *
 * Posting and editing must agree: an edit that accepted text a post would have
 * refused would let the same field hold two different ideas of what a comment
 * is, and the reader who hit the ceiling while typing would find it moved
 * afterwards (#503). Client-safe, so the rule can be unit tested without the
 * server module and its `createServerFn` imports.
 *
 * The trim runs before the length check, which is deliberate: a body padded
 * past the ceiling is the same comment once trimmed.
 */
export const COMMENT_MAX_LENGTH = 5000;

export const commentContent = z.string().trim().min(1).max(COMMENT_MAX_LENGTH);
