import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const idSchema = z.object({ id: z.string().uuid() });

/**
 * The bell's one read per tick: the unread count and the ten newest rows
 * together, so a signed-in tab costs one request and one session read a
 * minute rather than two of each (#725).
 */
export const getMyNotifications = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getMyNotificationsForCurrentUser } = await import(
      "./_internal/notifications"
    );
    return getMyNotificationsForCurrentUser();
  }
);

/**
 * Stale-tab stubs for the bell before #729, which polled these two every
 * minute. Tabs opened before that deploy still do, and each poll was a 500
 * that kept `eecs-capstone-app-5xx` firing. A server function's id is a hash
 * of this file's path and the export name, so neither may move or be renamed.
 * They answer an empty bell without reading the session. Remove in #774.
 */
export const listMyNotifications = createServerFn({ method: "GET" }).handler(
  () => ({ rows: [] })
);

export const unreadCount = createServerFn({ method: "GET" }).handler(() => ({
  count: 0,
}));

export const markRead = createServerFn({ method: "POST" })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { markReadForCurrentUser } = await import(
      "./_internal/notifications"
    );
    return markReadForCurrentUser(data);
  });

export const markAllRead = createServerFn({ method: "POST" }).handler(
  async () => {
    const { markAllReadForCurrentUser } = await import(
      "./_internal/notifications"
    );
    return markAllReadForCurrentUser();
  }
);
