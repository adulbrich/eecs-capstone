import { describe, expect, it } from "vitest";
import { z } from "zod";
import { itemPayloadSchema } from "#/server/inventory";

const approveSchema = z.object({
  requestItemId: z.string().uuid(),
  pickupBy: z.coerce.date().nullable().default(null),
});

const rejectSchema = z.object({
  requestItemId: z.string().uuid(),
  reviewComment: z.string().min(1).max(2000),
});

describe("inventory schemas", () => {
  it("itemPayload rejects empty name", () => {
    expect(() => itemPayloadSchema.parse({ name: "" })).toThrow();
  });

  it("itemPayload keeps categoryId rather than stripping it", () => {
    const categoryId = "11111111-1111-4111-8111-111111111111";
    const parsed = itemPayloadSchema.parse({ name: "Drill", categoryId });
    expect(parsed.categoryId).toBe(categoryId);
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
