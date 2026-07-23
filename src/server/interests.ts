import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const saveSchema = z.object({ interestsText: z.string().max(2000) });

export const getMyInterests = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getMyInterestsForCurrentUser } = await import(
      "./_internal/interests"
    );
    return getMyInterestsForCurrentUser();
  }
);

export const saveMyInterests = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => saveSchema.parse(data))
  .handler(async ({ data }) => {
    const { saveMyInterestsForCurrentUser } = await import(
      "./_internal/interests"
    );
    return saveMyInterestsForCurrentUser(data.interestsText);
  });
