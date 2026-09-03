import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const idSchema = z.object({ id: z.string().uuid() });

export const listMyNotifications = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listMyNotificationsForCurrentUser } = await import(
      "./_internal/notifications"
    );
    return listMyNotificationsForCurrentUser();
  }
);

export const unreadCount = createServerFn({ method: "GET" }).handler(
  async () => {
    const { unreadCountForCurrentUser } = await import(
      "./_internal/notifications"
    );
    return unreadCountForCurrentUser();
  }
);

export const markRead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idSchema.parse(data))
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
