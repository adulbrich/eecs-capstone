import { describe, expect, it } from "vitest";
import { z } from "zod";

const itemPayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().default(null),
  category: z.string().max(120).nullable().default(null),
  serial: z.string().max(120).nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  notes: z.string().max(5000).nullable().default(null),
  imageUrl: z.string().max(500).nullable().default(null),
});

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
