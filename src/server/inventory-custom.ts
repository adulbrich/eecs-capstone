import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Custom requests: asks for equipment the inventory does not hold. Its own
 * namespace rather than more of `./inventory.ts`, following the split #104
 * made on the internals. One endpoint per action over an `*As` seam in
 * `./_internal/inventory-custom.ts` (ADR-0002); each has its line in
 * `src/server/__tests__/access-contract.ts` (ADR-0003).
 */

// A floor of one, the idiom this module uses for a floor of one on a number
// (`.min(1)` is for strings); no CHECK constraint backs it.
export const customLineInputSchema = z.object({
  name: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  quantity: z.number().int().positive().max(100),
  link: z.string().max(500).nullable().default(null),
});

const submitCustomRequestSchema = z.object({
  lines: z.array(customLineInputSchema).min(1).max(20),
  note: z.string().max(2000).nullable().default(null),
});

export type SubmitCustomRequestInput = z.infer<
  typeof submitCustomRequestSchema
>;

export const submitCustomRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitCustomRequestSchema.parse(d))
  .handler(async ({ data }) => {
    const { submitCustomRequestForCurrentUser } = await import(
      "./_internal/inventory-custom"
    );
    return submitCustomRequestForCurrentUser(data);
  });

const lineId = z.string().uuid();

export const startSourcingCustomLine = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customLineId: lineId,
        sourcingNote: z.string().max(2000).nullable().default(null),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { startSourcingCustomLineForCurrentUser } = await import(
      "./_internal/inventory-custom"
    );
    return startSourcingCustomLineForCurrentUser(data);
  });

export const updateSourcingNote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customLineId: lineId,
        sourcingNote: z.string().min(1).max(2000),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { updateSourcingNoteForCurrentUser } = await import(
      "./_internal/inventory-custom"
    );
    return updateSourcingNoteForCurrentUser(data);
  });

export const rejectCustomLine = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customLineId: lineId,
        outcomeNote: z.string().min(1).max(2000),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { rejectCustomLineForCurrentUser } = await import(
      "./_internal/inventory-custom"
    );
    return rejectCustomLineForCurrentUser(data);
  });

export const fulfillCustomLine = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customLineId: lineId,
        itemIds: z.array(z.string().uuid()).min(1).max(50),
        outcomeNote: z.string().max(2000).nullable().default(null),
        pickupBy: z.coerce.date().nullable().default(null),
        // Ticked by default: the thing arrived for someone, and that someone
        // is on the line.
        reserve: z.boolean().default(true),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { fulfillCustomLineForCurrentUser } = await import(
      "./_internal/inventory-custom"
    );
    return fulfillCustomLineForCurrentUser(data);
  });

export const cancelCustomLine = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customLineId: lineId,
        outcomeNote: z.string().max(2000).nullable().default(null),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { cancelCustomLineForCurrentUser } = await import(
      "./_internal/inventory-custom"
    );
    return cancelCustomLineForCurrentUser(data);
  });
