import { describe, expect, it } from "vitest";
import {
  attentionSummary,
  compareByDeadline,
  type DeadlineEntry,
  deadlineOf,
  deadlinePairOf,
  isOverdue,
  needsAttention,
  overdueFlags,
} from "../inventory-deadlines";

/** A fixed clock, because the boundaries are the whole content of the rule. */
const NOW = new Date("2026-08-11T12:00:00Z").getTime();
const BEFORE = new Date(NOW - 1000);
const AFTER = new Date(NOW + 1000);

describe("overdueFlags", () => {
  it("flags a reserved item once its pickup window has passed", () => {
    expect(
      overdueFlags({ status: "reserved", pickupBy: BEFORE, dueAt: null }, NOW)
    ).toEqual({ pickupOverdue: true, checkoutOverdue: false });
  });

  it("does not flag a reserved item still inside its window", () => {
    expect(
      overdueFlags({ status: "reserved", pickupBy: AFTER, dueAt: null }, NOW)
    ).toEqual({ pickupOverdue: false, checkoutOverdue: false });
  });

  it("does not flag exactly at the deadline", () => {
    // Strictly past, not at. A deadline of noon is not missed at noon.
    expect(
      overdueFlags(
        { status: "reserved", pickupBy: new Date(NOW), dueAt: null },
        NOW
      ).pickupOverdue
    ).toBe(false);
  });

  it("flags a checked-out item once it is past due", () => {
    expect(
      overdueFlags(
        { status: "checked_out", pickupBy: null, dueAt: BEFORE },
        NOW
      )
    ).toEqual({ pickupOverdue: false, checkoutOverdue: true });
  });

  it("keys off the item's status, so a reserved item past dueAt flags nothing", () => {
    // The status decides which deadline applies. An approved line sits on an
    // item that is either reserved (pre-pickup) or checked out (post-pickup),
    // and only the second is answerable for a due date.
    expect(
      overdueFlags({ status: "reserved", pickupBy: null, dueAt: BEFORE }, NOW)
    ).toEqual({ pickupOverdue: false, checkoutOverdue: false });
  });

  it("flags nothing without a date, and nothing for an idle status", () => {
    expect(
      overdueFlags({ status: "checked_out", pickupBy: null, dueAt: null }, NOW)
    ).toEqual({ pickupOverdue: false, checkoutOverdue: false });
    expect(
      overdueFlags(
        { status: "available", pickupBy: BEFORE, dueAt: BEFORE },
        NOW
      )
    ).toEqual({ pickupOverdue: false, checkoutOverdue: false });
  });

  it("defaults the clock to now", () => {
    const longAgo = new Date("2000-01-01");
    expect(
      overdueFlags({ status: "checked_out", pickupBy: null, dueAt: longAgo })
        .checkoutOverdue
    ).toBe(true);
  });
});

describe("isOverdue", () => {
  it("is true for either kind and false for neither", () => {
    expect(
      isOverdue({ status: "reserved", pickupBy: BEFORE, dueAt: null }, NOW)
    ).toBe(true);
    expect(
      isOverdue({ status: "checked_out", pickupBy: null, dueAt: BEFORE }, NOW)
    ).toBe(true);
    expect(
      isOverdue({ status: "checked_out", pickupBy: null, dueAt: AFTER }, NOW)
    ).toBe(false);
    expect(
      isOverdue({ status: "available", pickupBy: BEFORE, dueAt: BEFORE }, NOW)
    ).toBe(false);
  });

  it("is false exactly at the deadline, like the flags it reads", () => {
    expect(
      isOverdue(
        { status: "checked_out", pickupBy: null, dueAt: new Date(NOW) },
        NOW
      )
    ).toBe(false);
  });

  it("defaults the clock to now", () => {
    expect(
      isOverdue({
        status: "checked_out",
        pickupBy: null,
        dueAt: new Date("2000-01-01"),
      })
    ).toBe(true);
  });
});

const hold = (over: Partial<{ status: string }> = {}): DeadlineEntry => ({
  kind: "hold",
  item: {
    status: "checked_out",
    pickupBy: new Date("2026-08-01"),
    dueAt: new Date("2026-08-05"),
    updatedAt: new Date("2026-07-01"),
    ...over,
  },
});

const request = (): DeadlineEntry => ({
  kind: "request",
  itemStatus: "reserved",
  line: {
    pickupBy: new Date("2026-08-02"),
    dueAt: null,
    createdAt: new Date("2026-07-02"),
  },
});

describe("deadlinePairOf", () => {
  it("reads a hold's pair from the item's own columns", () => {
    expect(deadlinePairOf(hold())).toEqual({
      status: "checked_out",
      pickupBy: new Date("2026-08-01"),
      dueAt: new Date("2026-08-05"),
    });
  });

  it("reads a request's pair from the line, with the item's status", () => {
    // The one place that knows which arm stores the pair where. Without it
    // the server sort and the client badge each have to know.
    expect(deadlinePairOf(request())).toEqual({
      status: "reserved",
      pickupBy: new Date("2026-08-02"),
      dueAt: null,
    });
  });
});

describe("deadlineOf", () => {
  it("prefers the due date over the pickup date", () => {
    expect(deadlineOf(hold())).toEqual(new Date("2026-08-05"));
  });

  it("falls back to the pickup date", () => {
    expect(deadlineOf(request())).toEqual(new Date("2026-08-02"));
  });

  it("is null when neither is set", () => {
    expect(
      deadlineOf(hold({ pickupBy: null, dueAt: null } as never))
    ).toBeNull();
  });
});

describe("compareByDeadline", () => {
  const withDeadline = (due: string, updated: string): DeadlineEntry => ({
    kind: "hold",
    item: {
      status: "checked_out",
      pickupBy: null,
      dueAt: new Date(due),
      updatedAt: new Date(updated),
    },
  });
  const without = (updated: string): DeadlineEntry => ({
    kind: "hold",
    item: {
      status: "reserved",
      pickupBy: null,
      dueAt: null,
      updatedAt: new Date(updated),
    },
  });

  it("puts the soonest deadline first", () => {
    const late = withDeadline("2026-09-01", "2026-01-01");
    const soon = withDeadline("2026-08-01", "2026-01-01");
    expect([late, soon].sort(compareByDeadline)).toEqual([soon, late]);
  });

  it("puts entries with no deadline last", () => {
    const none = without("2026-01-01");
    const some = withDeadline("2026-09-01", "2026-01-01");
    expect([none, some].sort(compareByDeadline)).toEqual([some, none]);
  });

  it("breaks a deadline tie by recency, newest first", () => {
    const older = withDeadline("2026-08-01", "2026-01-01");
    const newer = withDeadline("2026-08-01", "2026-06-01");
    expect([older, newer].sort(compareByDeadline)).toEqual([newer, older]);
  });

  it("orders two entries without deadlines by recency", () => {
    // The created_at DESC order the Active tab had before holds existed,
    // kept as the fallback for everything a deadline cannot order.
    const older = without("2026-01-01");
    const newer = without("2026-06-01");
    expect([older, newer].sort(compareByDeadline)).toEqual([newer, older]);
  });
});

describe("attentionSummary", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);
  const hold = (status: string, dueAt: Date | null, pickupBy: Date | null) =>
    ({
      kind: "hold" as const,
      item: { status, dueAt, pickupBy, updatedAt: now },
    }) satisfies DeadlineEntry;
  const request = (
    itemStatus: string,
    dueAt: Date | null,
    pickupBy: Date | null
  ) =>
    ({
      kind: "request" as const,
      itemStatus,
      line: { createdAt: now, dueAt, pickupBy },
    }) satisfies DeadlineEntry;

  it("counts what is overdue and what is due within three days, from both arms", () => {
    const summary = attentionSummary(
      [
        hold("checked_out", day(-2), null),
        request("checked_out", day(2), null),
        request("reserved", null, day(-1)),
        hold("reserved", null, day(3)),
        hold("checked_out", day(10), null),
        request("requested", null, null),
      ],
      now
    );
    expect(summary).toEqual({
      overdueReturns: 1,
      overduePickups: 1,
      returnsDueSoon: 1,
      pickupsDueSoon: 1,
    });
  });

  it("is all zeros for a quiet page, which the caller renders as nothing wrong", () => {
    expect(attentionSummary([], now)).toEqual({
      overdueReturns: 0,
      overduePickups: 0,
      returnsDueSoon: 0,
      pickupsDueSoon: 0,
    });
    expect(needsAttention(attentionSummary([], now))).toBe(false);
    expect(
      needsAttention(attentionSummary([hold("checked_out", day(1), null)], now))
    ).toBe(true);
  });
});
