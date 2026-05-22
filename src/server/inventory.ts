import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const itemStatusEnum = z.enum([
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
]);

const listInventorySchema = z.object({
  q: z.string().default(""),
  status: itemStatusEnum.nullable().default(null),
  category: z.string().nullable().default(null),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(24),
});

export type ListInventoryInput = z.infer<typeof listInventorySchema>;

export const listInventory = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInventorySchema.parse(d))
  .handler(async ({ data }) => {
    const { listInventoryForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return listInventoryForCurrentUser(data);
  });

const idOnlySchema = z.object({ id: z.string().uuid() });

export const getInventoryItem = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idOnlySchema.parse(d))
  .handler(async ({ data }) => {
    const { getInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return getInventoryItemForCurrentUser(data);
  });
