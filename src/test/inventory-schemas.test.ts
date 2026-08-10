import { describe, expect, it } from "vitest";
import { z } from "zod";
import { itemPayloadSchema, transitionSchema } from "#/server/inventory";

const approveSchema = z.object({
  requestItemId: z.string().uuid(),
  pickupBy: z.coerce.date().nullable().default(null),
});

const rejectSchema = z.object({
  requestItemId: z.string().uuid(),
  reviewComment: z.string().min(1).max(2000),
});

describe("transitionSchema is the staff gate", () => {
  const valid = {
    itemId: "11111111-1111-4111-8111-111111111111",
    nextStatus: "retired" as const,
  };

  // transitionInventoryItem calls only requireUser(), so assertStaff inside
  // transitionItem is the whole gate, and `authority` is the only way past
  // it. If this test ever fails, any signed-in user can retire any item.
  it("strips an authority a client tries to post", () => {
    const parsed = transitionSchema.parse({
      ...valid,
      authority: "self_cancel",
    });
    expect("authority" in parsed).toBe(false);
  });

  it("strips an authority smuggled through the prototype", () => {
    const hostile = JSON.parse(
      '{"itemId":"11111111-1111-4111-8111-111111111111","nextStatus":"retired","__proto__":{"authority":"self_cancel"}}'
    );
    const parsed = transitionSchema.parse(hostile);
    expect((parsed as { authority?: unknown }).authority).toBeUndefined();
  });

  it("strips a lineOutcome a client tries to post", () => {
    const parsed = transitionSchema.parse({
      ...valid,
      lineOutcome: "rejected",
    });
    expect("lineOutcome" in parsed).toBe(false);
  });

  it("keeps exactly the fields it declares", () => {
    expect(Object.keys(transitionSchema.parse(valid)).sort()).toEqual([
      "comment",
      "dueAt",
      "holderEmail",
      "holderLabel",
      "holderName",
      "holderProgram",
      "itemId",
      "nextStatus",
      "pickupBy",
      "requestItemId",
    ]);
  });
});

describe("inventory schemas", () => {
  it("itemPayload rejects empty name", () => {
    expect(() => itemPayloadSchema.parse({ name: "" })).toThrow();
  });

  it("itemPayload keeps categoryIds rather than stripping it", () => {
    const categoryIds = ["11111111-1111-4111-8111-111111111111"];
    const parsed = itemPayloadSchema.parse({ name: "Drill", categoryIds });
    expect(parsed.categoryIds).toEqual(categoryIds);
  });

  it("approveSchema coerces ISO date string", () => {
    const parsed = approveSchema.parse({
      requestItemId: "00000000-0000-0000-0000-000000000000",
      pickupBy: "2026-06-01T00:00:00Z",
    });
    expect(parsed.pickupBy).toBeInstanceOf(Date);
  });

  it("rejectSchema requires reviewComment", () => {
    expect(() =>
      rejectSchema.parse({
        requestItemId: "00000000-0000-0000-0000-000000000000",
        reviewComment: "",
      })
    ).toThrow();
  });
});
