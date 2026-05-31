import { createServerFn } from "@tanstack/react-start";

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { readSession } = await import("./_internal/auth-guards");
    return readSession();
  }
);
