import { createServerFn } from "@tanstack/react-start";

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { readSession } = await import("./auth-guards.server");
    return readSession();
  },
);
