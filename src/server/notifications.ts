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
