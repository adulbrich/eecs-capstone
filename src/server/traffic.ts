import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DAY_PATTERN } from "#/lib/report-range";

export const trafficInputSchema = z
  .object({
    // Calendar days in the office's zone, inclusive, as the inputs speak them.
    from: z.string().regex(DAY_PATTERN),
    to: z.string().regex(DAY_PATTERN),
  })
  .refine((v) => v.from <= v.to, { message: "from must not be after to" });

export type TrafficInput = z.infer<typeof trafficInputSchema>;

export const getTraffic = createServerFn({ method: "GET" })
  .validator((data: unknown) => trafficInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getTrafficForCurrentUser } = await import("./_internal/traffic");
    return getTrafficForCurrentUser(data);
  });
