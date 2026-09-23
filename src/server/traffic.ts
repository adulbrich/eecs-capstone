import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const trafficInputSchema = z
  .object({
    // Calendar days in the office's zone, inclusive, as the inputs speak them.
    from: z.string().regex(DATE),
    to: z.string().regex(DATE),
  })
  .refine((v) => v.from <= v.to, { message: "from must not be after to" });

export type TrafficInput = z.infer<typeof trafficInputSchema>;

export const getTraffic = createServerFn({ method: "GET" })
  .validator((data: unknown) => trafficInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getTrafficForCurrentUser } = await import("./_internal/traffic");
    return getTrafficForCurrentUser(data);
  });
