import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  dayEnd,
  dayRange,
  dayStart,
  daysInclusive,
  formatOfficeDay,
  lastDeadlineDay,
  localDay,
  localInstant,
  OFFICE_TIME_ZONE,
  shiftDay,
} from "#/lib/day-range";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Sunday the clocks change in `year`, under the US rule since 2007: the
 * second in March, or the first in November.
 */
function changeSunday(year: number, month: 3 | 11): string {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  const date = month === 3 ? firstSunday + 7 : firstSunday;
  return `${year}-${pad(month)}-${pad(date)}`;
}

/**
 * Any day from 2007, or a change Sunday or a day either side of one. The
 * second branch is not optional: a wrong offset shows only on the change day
 * itself, and a uniform day lands on one about one run in two hundred.
 */
const officeDay = fc.oneof(
  fc
    .integer({ max: 34_000, min: 0 })
    .map((offset) => shiftDay("2007-01-01", offset)),
  fc
    .tuple(
      fc.integer({ max: 2099, min: 2007 }),
      fc.constantFrom<3 | 11>(3, 11),
      fc.integer({ max: 1, min: -1 })
    )
    .map(([year, month, delta]) => shiftDay(changeSunday(year, month), delta))
);

/**
 * An `HH:MM`, weighted toward the small hours: a change moves the offset at
 * 2:00, and a time from then until about 9:00 is where a guessed offset can
 * still be the old one.
 */
const wallTime = fc
  .tuple(
    fc.oneof(fc.integer({ max: 23, min: 0 }), fc.integer({ max: 9, min: 0 })),
    fc.integer({ max: 59, min: 0 })
  )
  .map(([hour, minute]) => `${pad(hour)}:${pad(minute)}`);

const officeClock = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: OFFICE_TIME_ZONE,
});

/** The spring change Sunday, when 2:00 to 2:59 does not happen. */
function isSpringChange(day: string): boolean {
  return day === changeSunday(Number(day.slice(0, 4)), 3);
}

// Pacific is UTC-8 in winter and UTC-7 in summer, so office midnight is
// 08:00Z or 07:00Z. The DST days are the ones a naive offset gets wrong.
describe("dayStart", () => {
  it("reads a winter day as Pacific Standard Time", () => {
    expect(dayStart("2026-01-15").toISOString()).toBe(
      "2026-01-15T08:00:00.000Z"
    );
  });

  it("reads a summer day as Pacific Daylight Time", () => {
    expect(dayStart("2026-07-04").toISOString()).toBe(
      "2026-07-04T07:00:00.000Z"
    );
  });

  it("gets both sides of the spring change", () => {
    // Clocks go forward at 2am on 2026-03-08; midnight is still PST, and
    // the next midnight is PDT, so that day is 23 hours long.
    expect(dayStart("2026-03-08").toISOString()).toBe(
      "2026-03-08T08:00:00.000Z"
    );
    expect(dayStart("2026-03-09").toISOString()).toBe(
      "2026-03-09T07:00:00.000Z"
    );
  });

  it("gets both sides of the autumn change", () => {
    // Clocks go back at 2am on 2026-11-01: a 25 hour day.
    expect(dayStart("2026-11-01").toISOString()).toBe(
      "2026-11-01T07:00:00.000Z"
    );
    expect(dayStart("2026-11-02").toISOString()).toBe(
      "2026-11-02T08:00:00.000Z"
    );
  });

  it("takes another zone when asked", () => {
    expect(dayStart("2026-07-04", "UTC").toISOString()).toBe(
      "2026-07-04T00:00:00.000Z"
    );
  });

  it("refuses anything that is not a day", () => {
    expect(() => dayStart("2026-7-4")).toThrow(/not a YYYY-MM-DD day/u);
  });
});

describe("localInstant", () => {
  it("reads a summer afternoon as Pacific Daylight Time", () => {
    expect(localInstant("2026-10-28", "14:00").toISOString()).toBe(
      "2026-10-28T21:00:00.000Z"
    );
  });

  it("reads the afternoon after each change on the new offset", () => {
    // Midnight on both change days is still the old offset; the afternoon
    // is already the new one, which a guess taken at midnight gets wrong.
    expect(localInstant("2026-03-08", "15:30").toISOString()).toBe(
      "2026-03-08T22:30:00.000Z"
    );
    expect(localInstant("2026-11-01", "15:30").toISOString()).toBe(
      "2026-11-01T23:30:00.000Z"
    );
  });

  it("refuses anything that is not a 24-hour HH:MM time", () => {
    expect(() => localInstant("2026-10-28", "2:00")).toThrow(
      /not an HH:MM time/u
    );
    expect(() => localInstant("2026-10-28", "24:00")).toThrow(
      /not an HH:MM time/u
    );
  });
});

describe("dayEnd", () => {
  it("is the last millisecond of the Pacific day, still that day", () => {
    const end = dayEnd("2026-10-28");
    expect(end.toISOString()).toBe("2026-10-29T06:59:59.999Z");
    expect(localDay(end)).toBe("2026-10-28");
  });

  it("follows the long autumn day", () => {
    expect(dayEnd("2026-11-01").toISOString()).toBe("2026-11-02T07:59:59.999Z");
  });
});

describe("dayRange", () => {
  it("keeps the whole of the last day: the end is the next Pacific midnight", () => {
    const { start, end } = dayRange("2026-06-30", "2026-06-30");
    expect(start?.toISOString()).toBe("2026-06-30T07:00:00.000Z");
    expect(end?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    // 10pm Pacific on the 30th is 05:00Z on the 1st, and it is inside.
    const lateOnThe30th = new Date("2026-07-01T05:00:00.000Z");
    expect(
      lateOnThe30th >= (start as Date) && lateOnThe30th < (end as Date)
    ).toBe(true);
  });

  it("leaves an absent bound open", () => {
    expect(dayRange(null, "2026-06-30")).toEqual({
      start: null,
      end: new Date("2026-07-01T07:00:00.000Z"),
    });
    expect(dayRange("2026-06-30", undefined)).toEqual({
      start: new Date("2026-06-30T07:00:00.000Z"),
      end: null,
    });
  });
});

describe("calendar arithmetic", () => {
  it("shifts across a month end and a DST change without drifting", () => {
    expect(shiftDay("2026-06-30", 1)).toBe("2026-07-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("counts both ends", () => {
    expect(daysInclusive("2026-06-30", "2026-06-30")).toBe(1);
    expect(daysInclusive("2026-06-01", "2026-06-30")).toBe(30);
    expect(daysInclusive("2026-03-01", "2026-03-31")).toBe(31);
  });
});

describe("lastDeadlineDay", () => {
  it("counts the year from the Pacific day, not the UTC one", () => {
    // 03:00Z on the 29th is 8 pm on the 28th in Corvallis.
    expect(lastDeadlineDay(Date.parse("2026-10-29T03:00:00.000Z"))).toBe(
      "2027-10-28"
    );
  });
});

describe("formatOfficeDay", () => {
  it("names the Pacific day, which is the next day in UTC by evening", () => {
    // The end of the 25th in Corvallis; already the 26th in UTC.
    expect(formatOfficeDay("2026-10-26T06:59:59.999Z")).toBe("Oct 25, 2026");
  });
});

describe("localDay", () => {
  it("turns over at Pacific Daylight midnight in summer", () => {
    expect(localDay(new Date("2026-07-05T06:59:00Z"))).toBe("2026-07-04");
    expect(localDay(new Date("2026-07-05T07:01:00Z"))).toBe("2026-07-05");
  });

  it("turns over at Pacific Standard midnight in winter", () => {
    expect(localDay(new Date("2026-01-16T07:59:00Z"))).toBe("2026-01-15");
    expect(localDay(new Date("2026-01-16T08:01:00Z"))).toBe("2026-01-16");
  });

  it("is the inverse of dayStart", () => {
    expect(localDay(dayStart("2026-03-09"))).toBe("2026-03-09");
    expect(localDay(dayStart("2026-11-01"))).toBe("2026-11-01");
  });
});

describe("the day helpers, on generated days", () => {
  test.prop([officeDay])(
    "start and end the day they are given, and leave no gap before the next",
    (day) => {
      expect(localDay(dayStart(day))).toBe(day);
      expect(localDay(dayEnd(day))).toBe(day);
      expect(dayEnd(day).getTime() + 1).toBe(
        dayStart(shiftDay(day, 1)).getTime()
      );
    }
  );

  test.prop([officeDay, fc.integer({ max: 400, min: -400 })])(
    "shift there and back to the same day",
    (day, delta) => {
      expect(shiftDay(shiftDay(day, delta), -delta)).toBe(day);
    }
  );

  test.prop([officeDay, fc.integer({ max: 400, min: 0 })])(
    "count both ends of a span",
    (day, delta) => {
      expect(daysInclusive(day, shiftDay(day, delta))).toBe(delta + 1);
    }
  );

  // The spring change skips 2:00 to 2:59, and `localInstant` documents that
  // such a time lands an hour earlier on the old offset; asserted, not excluded.
  test.prop([officeDay, wallTime])(
    "read back on the office clock as the day and time they were given",
    (day, time) => {
      const instant = localInstant(day, time);
      const [hour, minute] = time.split(":");
      const expected =
        hour === "02" && isSpringChange(day) ? `01:${minute}` : time;
      expect(localDay(instant)).toBe(day);
      expect(officeClock.format(instant)).toBe(expected);
    }
  );
});
