import { describe, expect, it } from "vitest";
import {
  formatPickupWindow,
  pickupContactSentence,
  pickupWindowInput,
  resolvePickupTerms,
  resolvePickupWindow,
} from "#/lib/pickup-window";

// 2026-10-28 is Pacific Daylight Time, UTC-7.
const NOW = Date.parse("2026-10-28T19:00:00.000Z"); // noon in Corvallis

function window(day: string | null, from: string | null, to: string | null) {
  return resolvePickupWindow(
    { pickupDay: day, pickupFromTime: from, pickupToTime: to },
    NOW
  );
}

describe("resolvePickupWindow", () => {
  it("leaves the deadline to the caller when no day is given", () => {
    expect(window(null, null, null)).toEqual({
      pickupFrom: null,
      pickupBy: null,
    });
    expect(window("  ", "", "")).toEqual({ pickupFrom: null, pickupBy: null });
  });

  it("reads a day alone as the whole of that Pacific day", () => {
    const { pickupFrom, pickupBy } = window("2026-10-30", null, null);
    expect(pickupFrom).toBeNull();
    expect(pickupBy?.toISOString()).toBe("2026-10-31T06:59:59.999Z");
  });

  it("composes both times on the day, in Pacific time", () => {
    const { pickupFrom, pickupBy } = window("2026-10-30", "14:00", "16:30");
    expect(pickupFrom?.toISOString()).toBe("2026-10-30T21:00:00.000Z");
    expect(pickupBy?.toISOString()).toBe("2026-10-30T23:30:00.000Z");
  });

  it("composes a window on the day the clocks go back", () => {
    const { pickupFrom, pickupBy } = window("2026-11-01", "14:00", "16:00");
    expect(pickupFrom?.toISOString()).toBe("2026-11-01T22:00:00.000Z");
    expect(pickupBy?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("accepts today, and a window already open but not yet over", () => {
    expect(window("2026-10-28", null, null).pickupBy).not.toBeNull();
    expect(window("2026-10-28", "11:00", "13:00").pickupBy).not.toBeNull();
  });

  it("refuses times without a day", () => {
    expect(() => window(null, "14:00", "16:00")).toThrow(
      "Pick a pickup day to go with the times."
    );
    expect(() => window(null, null, "16:00")).toThrow(
      "Pick a pickup day to go with the times."
    );
  });

  it("refuses a day that is not on the calendar instead of rolling it over", () => {
    expect(() => window("2027-02-31", null, null)).toThrow(
      "Pick a pickup day that is on the calendar."
    );
  });

  it("refuses a day more than a year out, year 9999 included", () => {
    expect(window("2027-10-28", null, null).pickupBy).not.toBeNull();
    expect(() => window("2027-10-29", null, null)).toThrow(
      "Pick a pickup day within the next year."
    );
    expect(() => window("9999-12-31", null, null)).toThrow(
      "Pick a pickup day within the next year."
    );
  });

  it("refuses one time without the other", () => {
    expect(() => window("2026-10-30", "14:00", null)).toThrow(
      "Give both a From and a To, or neither."
    );
    expect(() => window("2026-10-30", null, "16:00")).toThrow(
      "Give both a From and a To, or neither."
    );
  });

  it("refuses a window that does not end after it starts", () => {
    expect(() => window("2026-10-30", "16:00", "14:00")).toThrow(
      "The pickup window has to end after it starts."
    );
    expect(() => window("2026-10-30", "14:00", "14:00")).toThrow(
      "The pickup window has to end after it starts."
    );
  });

  it("refuses a window that has already ended", () => {
    expect(() => window("2026-10-27", null, null)).toThrow(
      "That pickup window has already ended."
    );
    expect(() => window("2026-10-28", "09:00", "11:00")).toThrow(
      "That pickup window has already ended."
    );
  });
});

describe("resolvePickupTerms", () => {
  it("trims the place and note, and stores a blank one as nothing", () => {
    expect(
      resolvePickupTerms(
        {
          pickupDay: null,
          pickupFromTime: null,
          pickupToTime: null,
          pickupPlace: "  KEC 1148 ",
          pickupNote: "   ",
        },
        NOW
      )
    ).toEqual({
      pickupFrom: null,
      pickupBy: null,
      pickupPlace: "KEC 1148",
      pickupNote: null,
    });
  });
});

describe("formatPickupWindow", () => {
  it("says nothing without a deadline", () => {
    expect(formatPickupWindow(null, null)).toBeNull();
  });

  it("names the Pacific day for a deadline alone, not the UTC one", () => {
    // 06:59Z on the 31st is still the 30th in Corvallis.
    expect(formatPickupWindow(null, "2026-10-31T06:59:59.999Z")).toBe(
      "Oct 30, 2026"
    );
  });

  it("names the day and both times for a window, with plain spaces", () => {
    expect(
      formatPickupWindow(
        new Date("2026-10-30T21:00:00.000Z"),
        new Date("2026-10-30T23:30:00.000Z")
      )
    ).toBe("Oct 30, 2026, 2:00 PM to 4:30 PM");
  });
});

describe("pickupWindowInput", () => {
  it("round-trips a window through the inputs", () => {
    const { pickupFrom, pickupBy } = window("2026-10-30", "14:00", "16:30");
    expect(pickupWindowInput(pickupFrom, pickupBy)).toEqual({
      pickupDay: "2026-10-30",
      pickupFromTime: "14:00",
      pickupToTime: "16:30",
    });
  });

  it("gives a deadline with no start back as its Pacific day alone", () => {
    expect(pickupWindowInput(null, "2026-10-31T06:59:59.999Z")).toEqual({
      pickupDay: "2026-10-30",
      pickupFromTime: null,
      pickupToTime: null,
    });
  });

  it("gives nothing back for no deadline", () => {
    expect(pickupWindowInput(null, null)).toEqual({
      pickupDay: null,
      pickupFromTime: null,
      pickupToTime: null,
    });
  });
});

describe("pickupContactSentence", () => {
  it("names the staff inbox", () => {
    expect(pickupContactSentence("capstone@oregonstate.edu")).toBe(
      "If this time doesn't work, email capstone@oregonstate.edu."
    );
  });

  it("says nothing when no inbox is configured", () => {
    expect(pickupContactSentence(null)).toBeNull();
  });
});
