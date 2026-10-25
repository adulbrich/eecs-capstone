import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  itemPayloadSchema,
  parseTransitionInput,
  transitionSchema,
} from "#/server/inventory";
import { parseFulfillCustomLineInput } from "#/server/inventory-custom";

const rejectSchema = z.object({
  requestItemId: z.string().uuid(),
  reviewComment: z.string().min(1).max(2000),
});

describe("transitionSchema is the staff gate", () => {
  const valid = {
    itemId: "11111111-1111-4111-8111-111111111111",
    nextStatus: "retired" as const,
  };

  // `authority` is the only way past the assertStaff inside transitionItem.
  // The endpoint's wrapper asserts staff too, for the order of refusals; if
  // this test ever fails, that one check is all that stands between any
  // signed-in user and retiring any item.
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
      // The due date as the day picked (#805); composed on the server.
      "dueDay",
      "holderEmail",
      "holderLabel",
      "holderName",
      "holderProgram",
      "itemId",
      "nextStatus",
      // The pickup terms as typed (#799); composed on the server.
      "pickupDay",
      "pickupFromTime",
      "pickupNote",
      "pickupPlace",
      "pickupToTime",
      "requestItemId",
      // The email-only skip (#387); `silent` is still not on the wire.
      "sendEmail",
    ]);
  });

  it("defaults the email skip to sending and still strips silent", () => {
    const parsed = transitionSchema.parse({ ...valid, silent: true });
    expect(parsed.sendEmail).toBe(true);
    expect("silent" in parsed).toBe(false);
    expect(
      transitionSchema.parse({ ...valid, sendEmail: false }).sendEmail
    ).toBe(false);
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

  // A coerced Date read "2026-10-28" as UTC midnight, the evening before in
  // Corvallis (#805). The strings go to `resolvePickupTerms` as typed.
  it("keeps the pickup day and times as the strings staff typed", () => {
    const parsed = transitionSchema.parse({
      itemId: "11111111-1111-4111-8111-111111111111",
      nextStatus: "reserved",
      pickupDay: "2026-10-28",
      pickupFromTime: "14:00",
      pickupToTime: "",
    });
    expect(parsed.pickupDay).toBe("2026-10-28");
    expect(parsed.pickupFromTime).toBe("14:00");
    expect(parsed.pickupToTime).toBe("");
  });

  it("refuses a pickup day or time in any other shape", () => {
    const base = {
      itemId: "11111111-1111-4111-8111-111111111111",
      nextStatus: "reserved",
    };
    expect(() =>
      transitionSchema.parse({ ...base, pickupDay: "2026-10-28T00:00:00Z" })
    ).toThrow();
    expect(() =>
      transitionSchema.parse({ ...base, pickupFromTime: "2pm" })
    ).toThrow();
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

describe("a tab loaded before #805", () => {
  // It sends the picked day under the old name, which the schema would drop
  // silently: a Fulfil would reserve with the seven-day default instead.
  const STALE = "This page is out of date. Reload it and pick the day again.";
  const ITEM = "11111111-1111-4111-8111-111111111111";
  const LINE = "22222222-2222-4222-8222-222222222222";

  it("is refused when it sends a picked day", () => {
    expect(() =>
      parseTransitionInput({
        itemId: ITEM,
        nextStatus: "checked_out",
        holderLabel: "Lab 204",
        dueAt: "2026-10-25T00:00:00.000Z",
      })
    ).toThrow(STALE);
    expect(() =>
      parseFulfillCustomLineInput({
        customLineId: LINE,
        itemIds: [ITEM],
        pickupBy: "2026-10-25T00:00:00.000Z",
      })
    ).toThrow(STALE);
  });

  it("goes through when it picked no day, which means the same today", () => {
    // Old clients sent the key as null on every other transition, and on a
    // Fulfil with reserve unticked or no day.
    expect(
      parseTransitionInput({
        itemId: ITEM,
        nextStatus: "available",
        dueAt: null,
      }).dueDay
    ).toBeNull();
    expect(
      parseFulfillCustomLineInput({
        customLineId: LINE,
        itemIds: [ITEM],
        pickupBy: null,
        reserve: false,
      }).pickupDay
    ).toBeNull();
  });
});
