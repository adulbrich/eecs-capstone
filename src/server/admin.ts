import { createServerFn } from "@tanstack/react-start";

export const getAdminStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getAdminStatsForCurrentUser } = await import("./_internal/admin");
    return getAdminStatsForCurrentUser();
  }
);
