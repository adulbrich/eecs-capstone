import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const analyticsInputSchema = z
  .object({
    // Calendar days, inclusive, as the date inputs speak them.
    from: z.string().regex(DATE),
    to: z.string().regex(DATE),
    programId: z.string().uuid().nullable().default(null),
  })
  .refine((v) => v.from <= v.to, { message: "from must not be after to" });

export type AnalyticsInput = z.infer<typeof analyticsInputSchema>;

export const getAnalytics = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => analyticsInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getAnalyticsForCurrentUser } = await import(
      "./_internal/analytics"
    );
    return getAnalyticsForCurrentUser(data);
  });
