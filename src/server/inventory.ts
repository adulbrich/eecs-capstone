import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function expectFormData(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw new Error("Expected FormData");
  }
  return data;
}

export const uploadInventoryImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => expectFormData(data))
  .handler(async ({ data }) => {
    const { uploadInventoryImageForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return uploadInventoryImageForCurrentUser(data);
  });

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
  categories: z.array(z.string().uuid()).max(20).default([]),
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

const listAdminInventorySchema = z.object({
  categories: z.array(z.string().uuid()).max(20).default([]),
  q: z.string().default(""),
  // Staff only, and deliberately absent from listInventorySchema. Retired
  // items are the archive; this is the only way to list them. `visibleStatuses`
  // also ignores the flag for a viewer who may not see retired, so a request
  // has to defeat two independent things to reach a retired row.
  retiredOnly: z.boolean().default(false),
  status: itemStatusEnum.nullable().default(null),
});

export type ListAdminInventoryInput = z.infer<typeof listAdminInventorySchema>;

export const listAdminInventory = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listAdminInventorySchema.parse(d))
  .handler(async ({ data }) => {
    const { listAdminInventoryForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return listAdminInventoryForCurrentUser(data);
  });

export const listInventoryCategories = createServerFn({
  method: "GET",
}).handler(async () => {
  const { listInventoryCategoriesImpl } = await import("./_internal/inventory");
  return listInventoryCategoriesImpl();
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

export const getInventoryItemDetail = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idOnlySchema.parse(d))
  .handler(async ({ data }) => {
    const { getInventoryItemDetailForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return getInventoryItemDetailForCurrentUser(data);
  });

export const itemPayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().default(null),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  serial: z.string().max(120).nullable().default(null),
  label: z.string().max(120).nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  notes: z.string().max(5000).nullable().default(null),
  imageUrl: z.string().max(500).nullable().default(null),
});

export type CreateInventoryItemInput = z.infer<typeof itemPayloadSchema>;

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

export type UpdateInventoryItemInput = z.infer<typeof updatePayloadSchema>;

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

export const getCart = createServerFn({ method: "GET" }).handler(async () => {
  const { getCartForCurrentUser } = await import("./_internal/inventory-cart");
  return getCartForCurrentUser();
});

const addToCartSchema = z.object({ itemId: z.string().uuid() });

export const addToCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addToCartSchema.parse(d))
  .handler(async ({ data }) => {
    const { addToCartForCurrentUser } = await import(
      "./_internal/inventory-cart"
    );
    return addToCartForCurrentUser(data);
  });

export const removeFromCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addToCartSchema.parse(d))
  .handler(async ({ data }) => {
    const { removeFromCartForCurrentUser } = await import(
      "./_internal/inventory-cart"
    );
    return removeFromCartForCurrentUser(data);
  });

const submitCartSchema = z.object({
  note: z.string().max(2000).nullable().default(null),
});

export const submitCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitCartSchema.parse(d))
  .handler(async ({ data }) => {
    const { submitCartForCurrentUser } = await import(
      "./_internal/inventory-cart"
    );
    return submitCartForCurrentUser(data);
  });

const approveSchema = z.object({
  requestItemId: z.string().uuid(),
  pickupBy: z.coerce.date().nullable().default(null),
});

export const approveRequestItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => approveSchema.parse(d))
  .handler(async ({ data }) => {
    const { approveRequestItemForCurrentUser } = await import(
      "./_internal/inventory-requests"
    );
    return approveRequestItemForCurrentUser(data);
  });

const rejectSchema = z.object({
  requestItemId: z.string().uuid(),
  reviewComment: z.string().min(1).max(2000),
});

export const rejectRequestItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rejectSchema.parse(d))
  .handler(async ({ data }) => {
    const { rejectRequestItemForCurrentUser } = await import(
      "./_internal/inventory-requests"
    );
    return rejectRequestItemForCurrentUser(data);
  });

const cancelSchema = z.object({
  requestItemId: z.string().uuid(),
  note: z.string().max(2000).nullable().default(null),
});

export const cancelRequestItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cancelSchema.parse(d))
  .handler(async ({ data }) => {
    const { cancelRequestItemForCurrentUser } = await import(
      "./_internal/inventory-requests"
    );
    return cancelRequestItemForCurrentUser(data);
  });

export const listMyItems = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listMyItemsForCurrentUser } = await import("./_internal/inventory");
    return listMyItemsForCurrentUser();
  }
);

const requestQueueSchema = z.object({
  // "all" is a view, never combinable with a specific status, so it is one of
  // the exclusive options rather than a separate flag.
  status: z
    .enum(["pending", "approved", "rejected", "cancelled", "returned", "all"])
    .default("pending"),
  q: z.string().default(""),
});

export type InventoryRequestQueueFilter = z.infer<typeof requestQueueSchema>;

export const listInventoryRequests = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => requestQueueSchema.parse(d))
  .handler(async ({ data }) => {
    const { listInventoryRequestsForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return listInventoryRequestsForCurrentUser(data);
  });

/**
 * Exported so `src/test/inventory-schemas.test.ts` can prove it strips
 * `authority`. That is not a style preference: `transitionInventoryItem`
 * carries only `requireUser()`, so `assertStaff` inside `transitionItem` is
 * the entire staff gate for this endpoint, and `authority` is the only way
 * past it. Adding `.passthrough()` or `.catchall()` here, or declaring the
 * field, would let any signed-in user retire any item. The test is what makes
 * that fail loudly instead of silently.
 */
export const transitionSchema = z.object({
  itemId: z.string().uuid(),
  nextStatus: z.enum([
    "available",
    "requested",
    "reserved",
    "checked_out",
    "maintenance",
    "retired",
  ]),
  requestItemId: z.string().uuid().nullable().default(null),
  // No holderId. Staff assign a hold by address or by label; the account is
  // resolved from the address server-side. The two callers that pass an
  // account id to transitionItem, approveRequestItemAs and submitCartAs, call
  // it directly and never go through this schema.
  holderEmail: z
    .union([z.string().email("Must be a valid email").max(200), z.null()])
    .default(null),
  holderLabel: z.string().max(200).nullable().default(null),
  holderName: z.string().max(200).nullable().default(null),
  holderProgram: z.string().max(200).nullable().default(null),
  pickupBy: z.coerce.date().nullable().default(null),
  dueAt: z.coerce.date().nullable().default(null),
  comment: z.string().max(2000).nullable().default(null),
});

export const transitionInventoryItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => transitionSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireUser } = await import("#/lib/_internal/auth-guards");
    const { transitionItem } = await import(
      "./_internal/inventory-transitions"
    );
    const viewer = await requireUser();
    await transitionItem(viewer, data);
    return { ok: true as const };
  });
