import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export const addBookmark = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { addBookmarkForCurrentUser } = await import("./_internal/bookmarks");
    return addBookmarkForCurrentUser(data);
  });

export const removeBookmark = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { removeBookmarkForCurrentUser } = await import(
      "./_internal/bookmarks"
    );
    return removeBookmarkForCurrentUser(data);
  });

export const isBookmarked = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { isBookmarkedForCurrentUser } = await import(
      "./_internal/bookmarks"
    );
    return isBookmarkedForCurrentUser(data);
  });

export const listMyBookmarks = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listMyBookmarksForCurrentUser } = await import(
      "./_internal/bookmarks"
    );
    return listMyBookmarksForCurrentUser();
  }
);
