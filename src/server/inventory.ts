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

const itemPayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().default(null),
  category: z.string().max(120).nullable().default(null),
  serial: z.string().max(120).nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  notes: z.string().max(5000).nullable().default(null),
  imageUrl: z.string().max(500).nullable().default(null),
});

export const createInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => itemPayloadSchema.parse(d))
  .handler(async ({ data }) => {
    const { createInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return createInventoryItemForCurrentUser(data);
  });

const updatePayloadSchema = itemPayloadSchema.extend({
  id: z.string().uuid(),
});

export const updateInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updatePayloadSchema.parse(d))
  .handler(async ({ data }) => {
    const { updateInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return updateInventoryItemForCurrentUser(data);
  });

const hardDeleteSchema = z.object({
  id: z.string().uuid(),
  confirmName: z.string().min(1),
});

export const hardDeleteInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => hardDeleteSchema.parse(d))
  .handler(async ({ data }) => {
    const { hardDeleteInventoryItemForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return hardDeleteInventoryItemForCurrentUser(data);
  });
