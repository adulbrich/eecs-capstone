import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { officeDay, wallTime } from "#/test/shared/arbitraries";
import {
  dayEnd,
  dayStart,
  lastDeadlineDay,
  localDay,
  localInstant,
  shiftDay,
} from "../day-range";
import {
  attentionSummary,
  checkoutFloorDay,
  compareByDeadline,
  type DeadlineEntry,
  deadlineOf,
  deadlinePairOf,
  dueAtForDay,
  isOverdue,
  needsAttention,
  overdueFlags,
  type StatusChange,
} from "../inventory-deadlines";

/** A fixed clock, because the boundaries are the whole content of the rule. */
const NOW = new Date("2026-08-11T12:00:00Z").getTime();
const BEFORE = new Date(NOW - 1000);
const AFTER = new Date(NOW + 1000);

/**
 * A checkout that began before every day the conversion tests below pick, so
 * they test the conversion and not the floor.
 */
const endOf = (day: string | null) => dueAtForDay(day, NOW, "2026-01-01");

const FLOOR_REFUSAL = /^Pick a due date on or after /u;
const CEILING_REFUSAL = "Pick a due date within the next year.";

/** A moment on the office clock, weighted toward the DST change days. */
const instant = fc
  .tuple(officeDay, wallTime)
  .map(([day, time]) => localInstant(day, time).getTime());

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

describe("dueAtForDay", () => {
  it("is the end of the day in Corvallis, not UTC midnight (#805)", () => {
    const due = endOf("2026-10-25");
    expect(due?.toISOString()).toBe("2026-10-26T06:59:59.999Z");
    const checkedOut = { status: "checked_out", pickupBy: null, dueAt: due };
    // 11 pm Pacific on the 25th, then just past midnight into the 26th.
    const elevenPm = new Date("2026-10-26T06:00:00Z").getTime();
    const midnight = new Date("2026-10-26T07:00:00Z").getTime();
    expect(overdueFlags(checkedOut, elevenPm).checkoutOverdue).toBe(false);
    expect(overdueFlags(checkedOut, midnight).checkoutOverdue).toBe(true);
  });

  it("keeps the picked day across both DST changes", () => {
    // Fall back on 2026-11-01: the day before ends on PDT, the day itself
    // on PST, an hour later in UTC.
    expect(endOf("2026-10-31")?.toISOString()).toBe("2026-11-01T06:59:59.999Z");
    expect(endOf("2026-11-01")?.toISOString()).toBe("2026-11-02T07:59:59.999Z");
    // Spring forward on 2026-03-08: the reverse.
    expect(endOf("2026-03-07")?.toISOString()).toBe("2026-03-08T07:59:59.999Z");
    expect(endOf("2026-03-08")?.toISOString()).toBe("2026-03-09T06:59:59.999Z");
  });

  it("reads blank as no due date", () => {
    expect(dueAtForDay(null)).toBeNull();
    expect(dueAtForDay("")).toBeNull();
    expect(dueAtForDay("  ")).toBeNull();
  });

  it("refuses a day that is not on the calendar", () => {
    expect(() => endOf("2026-02-31")).toThrow(
      "Pick a due date that is on the calendar."
    );
  });

  it("takes the checkout day, refuses the day before, and refuses one more than a year out", () => {
    // NOW is the morning of 2026-08-11 in Corvallis, and a checkout saved
    // then has today as its floor.
    expect(dueAtForDay("2026-08-11", NOW)).not.toBeNull();
    expect(() => dueAtForDay("2026-08-10", NOW)).toThrow(
      "Pick a due date on or after Aug 11, 2026. An item cannot be due before the day it was checked out."
    );
    // A checkout re-saved ten days in keeps the day it began as its floor.
    expect(dueAtForDay("2026-08-01", NOW, "2026-08-01")).not.toBeNull();
    expect(() => dueAtForDay("2026-07-31", NOW, "2026-08-01")).toThrow(
      "Pick a due date on or after Aug 1, 2026."
    );
    expect(lastDeadlineDay(NOW)).toBe("2027-08-11");
    expect(dueAtForDay("2027-08-11", NOW)).not.toBeNull();
    expect(() => dueAtForDay("2027-08-12", NOW)).toThrow(CEILING_REFUSAL);
    // Before the cap, the calendar arithmetic threw its own message here.
    expect(() => dueAtForDay("9999-12-31", NOW)).toThrow(CEILING_REFUSAL);
  });

  it("names the floor for a year typed short, even one the calendar cannot read", () => {
    // 0026 is a two-digit year in a date input; `Date.UTC` reads 0 to 99 as
    // 1900 to 1999, so the calendar check alone would call it off the
    // calendar. 0999 is the day `localDay` cannot print padded.
    for (const typo of [
      "2002-08-11",
      "0202-08-11",
      "0026-08-11",
      "0999-12-31",
    ]) {
      expect(() => dueAtForDay(typo, NOW)).toThrow(FLOOR_REFUSAL);
    }
  });

  it("moves today at midnight in Corvallis across both DST changes", () => {
    const at = (iso: string) => Date.parse(iso);
    // Fall back on 2026-11-01: the day starts on PDT and ends on PST.
    expect(dueAtForDay("2026-10-31", at("2026-11-01T06:59:59.999Z"))).not.toBe(
      null
    );
    expect(() =>
      dueAtForDay("2026-10-31", at("2026-11-01T07:00:00.000Z"))
    ).toThrow(FLOOR_REFUSAL);
    expect(dueAtForDay("2026-11-01", at("2026-11-02T07:59:59.999Z"))).not.toBe(
      null
    );
    expect(() =>
      dueAtForDay("2026-11-01", at("2026-11-02T08:00:00.000Z"))
    ).toThrow(FLOOR_REFUSAL);
    // Spring forward on 2026-03-08: starts on PST, ends on PDT.
    expect(dueAtForDay("2026-03-07", at("2026-03-08T07:59:59.999Z"))).not.toBe(
      null
    );
    expect(() =>
      dueAtForDay("2026-03-07", at("2026-03-08T08:00:00.000Z"))
    ).toThrow(FLOOR_REFUSAL);
    expect(dueAtForDay("2026-03-08", at("2026-03-09T06:59:59.999Z"))).not.toBe(
      null
    );
    expect(() =>
      dueAtForDay("2026-03-08", at("2026-03-09T07:00:00.000Z"))
    ).toThrow(FLOOR_REFUSAL);
  });

  /**
   * Where the candidate day sits: anywhere, or within two days of either
   * bound, where a wrong comparison shows and a uniform pick rarely lands.
   */
  const placement = fc.oneof(
    fc.record({
      edge: fc.constant("floor" as const),
      by: fc.integer({ max: 800, min: -800 }),
    }),
    fc.record({
      edge: fc.constantFrom("floor" as const, "ceiling" as const),
      by: fc.integer({ max: 2, min: -2 }),
    })
  );

  test.prop([officeDay, wallTime, fc.integer({ max: 400, min: 0 }), placement])(
    "takes a calendar day exactly when it falls from the checkout day to a year past today",
    (day, time, daysSinceCheckout, { edge, by }) => {
      const now = localInstant(day, time).getTime();
      const today = localDay(new Date(now));
      const floor = shiftDay(today, -daysSinceCheckout);
      // Counted in days from the floor, so the expectation is arithmetic on
      // integers rather than the string comparison under test.
      const ceilingOffset = daysSinceCheckout + 365;
      const offset = edge === "floor" ? by : ceilingOffset + by;
      const picked = shiftDay(floor, offset);
      if (offset < 0) {
        expect(() => dueAtForDay(picked, now, floor)).toThrow(FLOOR_REFUSAL);
      } else if (offset > ceilingOffset) {
        expect(() => dueAtForDay(picked, now, floor)).toThrow(CEILING_REFUSAL);
      } else {
        expect(dueAtForDay(picked, now, floor)).toEqual(dayEnd(picked));
      }
    }
  );

  test.prop([officeDay, fc.integer({ max: 900, min: 1 }), instant])(
    "names the floor in its refusal, whatever the floor",
    (floor, daysShort, now) => {
      // Spelled out here rather than through `formatOfficeDay`, so the
      // property does not share the formatter it checks.
      const [year, month, date] = floor.split("-").map(Number);
      const named = `${MONTHS[month - 1]} ${date}, ${year}`;
      expect(() =>
        dueAtForDay(shiftDay(floor, -daysShort), now, floor)
      ).toThrow(`Pick a due date on or after ${named}.`);
    }
  );

  test.prop([officeDay])(
    "moves today over at midnight in Corvallis, change days included",
    (day) => {
      const midnight = dayStart(day).getTime();
      const yesterday = shiftDay(day, -1);
      expect(dueAtForDay(day, midnight)).toEqual(dayEnd(day));
      expect(() => dueAtForDay(yesterday, midnight)).toThrow(FLOOR_REFUSAL);
      expect(dueAtForDay(yesterday, midnight - 1)).toEqual(dayEnd(yesterday));
    }
  );
});

describe("checkoutFloorDay", () => {
  const change = (
    oldStatus: string | null,
    newStatus: string,
    createdAt: string
  ): StatusChange => ({ createdAt, newStatus, oldStatus });

  // Newest first, as `getItemHistoryAs` orders them.
  const history = [
    change("checked_out", "checked_out", "2026-08-09T18:00:00Z"),
    // 11:30 pm on Aug 2 in Corvallis, already Aug 3 in UTC.
    change("reserved", "checked_out", "2026-08-03T06:30:00Z"),
    change("available", "reserved", "2026-07-30T18:00:00Z"),
    change("checked_out", "available", "2026-07-01T18:00:00Z"),
    change("available", "checked_out", "2026-06-20T18:00:00Z"),
  ];

  it("is today for an item the transition will check out", () => {
    expect(checkoutFloorDay("available", [], NOW)).toBe("2026-08-11");
    expect(checkoutFloorDay("reserved", history, NOW)).toBe("2026-08-11");
  });

  it("is the day the current checkout began, in Corvallis, past any re-save", () => {
    expect(checkoutFloorDay("checked_out", history, NOW)).toBe("2026-08-02");
  });

  it("counts a first history row with no old status as a checkout", () => {
    expect(
      checkoutFloorDay(
        "checked_out",
        [change(null, "checked_out", "2026-08-05T18:00:00Z")],
        NOW
      )
    ).toBe("2026-08-05");
  });

  it("falls back to today with no checkout in the history, and never passes it", () => {
    expect(checkoutFloorDay("checked_out", [], NOW)).toBe("2026-08-11");
    // A browser clock behind the server's sees the checkout in its future.
    expect(
      checkoutFloorDay(
        "checked_out",
        [change("available", "checked_out", "2026-08-12T18:00:00Z")],
        NOW
      )
    ).toBe("2026-08-11");
  });

  /** History rows, some sharing one instant, in any order and status. */
  const rows = fc.array(
    fc.record({
      at: fc.oneof(instant, fc.constant(1_800_000_000_000)),
      newStatus: fc.constantFrom("available", "reserved", "checked_out"),
      oldStatus: fc.constantFrom<string | null>(
        null,
        "available",
        "reserved",
        "checked_out"
      ),
    }),
    { maxLength: 8 }
  );

  test.prop([rows, instant])(
    "never passes today, ignores row order, and reads a Date and its ISO string alike",
    (generated, now) => {
      const today = localDay(new Date(now));
      const asDates = generated.map(({ at, ...row }) => ({
        ...row,
        createdAt: new Date(at),
      }));
      const asStrings = generated.map(({ at, ...row }) => ({
        ...row,
        createdAt: new Date(at).toISOString(),
      }));
      const floor = checkoutFloorDay("checked_out", asDates, now);
      expect(floor <= today).toBe(true);
      expect(checkoutFloorDay("checked_out", [...asDates].reverse(), now)).toBe(
        floor
      );
      expect(checkoutFloorDay("checked_out", asStrings, now)).toBe(floor);
      expect(checkoutFloorDay("reserved", asDates, now)).toBe(today);
    }
  );
});

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
  const holdEntry = (
    status: string,
    dueAt: Date | null,
    pickupBy: Date | null
  ) =>
    ({
      kind: "hold" as const,
      item: { status, dueAt, pickupBy, updatedAt: now },
    }) satisfies DeadlineEntry;
  const requestEntry = (
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
        holdEntry("checked_out", day(-2), null),
        requestEntry("checked_out", day(2), null),
        requestEntry("reserved", null, day(-1)),
        holdEntry("reserved", null, day(3)),
        holdEntry("checked_out", day(10), null),
        requestEntry("requested", null, null),
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
      needsAttention(
        attentionSummary([holdEntry("checked_out", day(1), null)], now)
      )
    ).toBe(true);
  });
});
