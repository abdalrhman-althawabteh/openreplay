import { describe, expect, it } from "vitest";
import {
  addDays,
  generateSlots,
  isBookableSlot,
  monthGrid,
  monthOf,
  todayInZone,
  weekdayOf,
  zonedTimeToUtc,
  type SlotCalendar,
} from "@/lib/calendars/slots";

/** Mon–Fri 09:00–17:00 in New York, 30-minute calls, no buffer. */
function calendar(overrides: Partial<SlotCalendar> = {}): SlotCalendar {
  return {
    timezone: "America/New_York",
    durationMinutes: 30,
    bufferMinutes: 0,
    minNoticeHours: 0,
    maxDaysAhead: 30,
    availability: {
      "1": [["09:00", "17:00"]],
      "2": [["09:00", "17:00"]],
      "3": [["09:00", "17:00"]],
      "4": [["09:00", "17:00"]],
      "5": [["09:00", "17:00"]],
    },
    ...overrides,
  };
}

const iso = (date: Date) => date.toISOString();

describe("zonedTimeToUtc", () => {
  it("resolves a wall-clock time in a zone to the right UTC instant", () => {
    // Amman is a fixed UTC+3 since it abolished DST.
    expect(iso(zonedTimeToUtc("2026-06-15", "09:00", "Asia/Amman"))).toBe(
      "2026-06-15T06:00:00.000Z"
    );
  });

  it("uses the offset in force on that side of a DST change", () => {
    // US DST starts Sunday 2026-03-08. The Friday before is EST (UTC-5); the
    // Monday after is EDT (UTC-4) — same wall clock, different instant.
    expect(iso(zonedTimeToUtc("2026-03-06", "09:00", "America/New_York"))).toBe(
      "2026-03-06T14:00:00.000Z"
    );
    expect(iso(zonedTimeToUtc("2026-03-09", "09:00", "America/New_York"))).toBe(
      "2026-03-09T13:00:00.000Z"
    );
  });

  it("handles midnight, which some formatters render as hour 24", () => {
    expect(iso(zonedTimeToUtc("2026-06-15", "00:00", "Asia/Amman"))).toBe(
      "2026-06-14T21:00:00.000Z"
    );
  });
});

describe("date helpers", () => {
  it("knows the weekday of a date string", () => {
    expect(weekdayOf("2026-03-08")).toBe(0); // Sunday
    expect(weekdayOf("2026-03-09")).toBe(1); // Monday
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("reads today in the calendar's zone, not the server's", () => {
    // 22:00 UTC on the 14th is already the 15th in Amman (UTC+3).
    const now = new Date("2026-06-14T22:00:00.000Z");
    expect(todayInZone("Asia/Amman", now)).toBe("2026-06-15");
    expect(todayInZone("America/New_York", now)).toBe("2026-06-14");
  });
});

describe("generateSlots", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("fills one weekday window at the calendar's duration", () => {
    const slots = generateSlots({
      calendar: calendar(),
      fromISO: "2026-06-15", // a Monday
      toISO: "2026-06-15",
      now,
    });

    // 09:00–17:00 is 8 hours = 16 half-hour slots.
    expect(slots).toHaveLength(16);
    expect(iso(slots[0])).toBe("2026-06-15T13:00:00.000Z"); // 09:00 EDT
    expect(iso(slots[15])).toBe("2026-06-15T20:30:00.000Z"); // 16:30 EDT
  });

  it("returns nothing on a day with no window", () => {
    const slots = generateSlots({
      calendar: calendar(),
      fromISO: "2026-06-14", // a Sunday
      toISO: "2026-06-14",
      now,
    });
    expect(slots).toEqual([]);
  });

  it("honours a split morning/afternoon window and skips the gap", () => {
    const slots = generateSlots({
      calendar: calendar({
        availability: {
          "1": [
            ["09:00", "12:00"],
            ["13:00", "17:00"],
          ],
        },
      }),
      fromISO: "2026-06-15",
      toISO: "2026-06-15",
      now,
    });

    // 6 slots in the morning + 8 in the afternoon, with nothing over lunch.
    expect(slots).toHaveLength(14);
    expect(slots.map(iso)).not.toContain("2026-06-15T16:00:00.000Z"); // 12:00 EDT
    expect(slots.map(iso)).toContain("2026-06-15T17:00:00.000Z"); // 13:00 EDT
  });

  it("keeps the same wall-clock opening across a DST change", () => {
    const slots = generateSlots({
      calendar: calendar(),
      fromISO: "2026-03-06", // Friday, EST
      toISO: "2026-03-09", // Monday, EDT
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    // Both days open at 09:00 local, one hour apart in UTC.
    expect(iso(slots[0])).toBe("2026-03-06T14:00:00.000Z");
    expect(iso(slots[16])).toBe("2026-03-09T13:00:00.000Z");
  });

  it("drops slots inside the minimum notice window", () => {
    const slots = generateSlots({
      calendar: calendar({ minNoticeHours: 24 }),
      fromISO: "2026-06-15",
      toISO: "2026-06-15",
      // 09:00 EDT on the 15th is 13:00 UTC; +24h notice from 12:00 UTC on the
      // 15th means nothing before 12:00 UTC on the 16th is bookable.
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    expect(slots).toEqual([]);
  });

  it("stops at maxDaysAhead", () => {
    const slots = generateSlots({
      calendar: calendar({ maxDaysAhead: 3 }),
      fromISO: "2026-06-15",
      toISO: "2026-06-26",
      now: new Date("2026-06-15T00:00:00.000Z"),
    });
    const last = slots[slots.length - 1];
    expect(last.getTime()).toBeLessThanOrEqual(
      new Date("2026-06-18T00:00:00.000Z").getTime()
    );
  });

  it("spaces slots by the buffer", () => {
    const slots = generateSlots({
      calendar: calendar({ bufferMinutes: 15 }),
      fromISO: "2026-06-15",
      toISO: "2026-06-15",
      now,
    });

    // 30 + 15 = 45 minutes apart.
    expect(slots[1].getTime() - slots[0].getTime()).toBe(45 * 60_000);
  });

  it("excludes a slot taken by an existing booking", () => {
    const busy = [
      {
        startsAt: new Date("2026-06-15T14:00:00.000Z"), // 10:00 EDT
        endsAt: new Date("2026-06-15T14:30:00.000Z"),
      },
    ];
    const slots = generateSlots({
      calendar: calendar(),
      fromISO: "2026-06-15",
      toISO: "2026-06-15",
      busy,
      now,
    });

    expect(slots).toHaveLength(15);
    expect(slots.map(iso)).not.toContain("2026-06-15T14:00:00.000Z");
    expect(slots.map(iso)).toContain("2026-06-15T13:30:00.000Z");
  });

  it("clears the buffer around an existing booking too", () => {
    const busy = [
      {
        startsAt: new Date("2026-06-15T14:00:00.000Z"),
        endsAt: new Date("2026-06-15T14:30:00.000Z"),
      },
    ];
    const withBuffer = generateSlots({
      calendar: calendar({ bufferMinutes: 30 }),
      fromISO: "2026-06-15",
      toISO: "2026-06-15",
      busy,
      now,
    });

    // The 13:00 slot ends exactly when the buffer before the booking starts.
    expect(withBuffer.map(iso)).not.toContain("2026-06-15T13:30:00.000Z");
  });

  it("never returns a slot in the past", () => {
    const slots = generateSlots({
      calendar: calendar(),
      fromISO: "2026-06-01",
      toISO: "2026-06-15",
      now: new Date("2026-06-15T16:00:00.000Z"), // 12:00 EDT on the 15th
    });
    expect(slots.every((slot) => slot.getTime() >= Date.parse("2026-06-15T16:00:00.000Z"))).toBe(
      true
    );
  });
});

describe("isBookableSlot", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("accepts a real slot", () => {
    expect(
      isBookableSlot({
        calendar: calendar(),
        startsAt: new Date("2026-06-15T13:00:00.000Z"),
        busy: [],
        now,
      })
    ).toBe(true);
  });

  it("rejects a time that is not on the grid", () => {
    expect(
      isBookableSlot({
        calendar: calendar(),
        startsAt: new Date("2026-06-15T13:07:00.000Z"),
        busy: [],
        now,
      })
    ).toBe(false);
  });

  it("rejects a slot someone else already took", () => {
    expect(
      isBookableSlot({
        calendar: calendar(),
        startsAt: new Date("2026-06-15T13:00:00.000Z"),
        busy: [
          {
            startsAt: new Date("2026-06-15T13:00:00.000Z"),
            endsAt: new Date("2026-06-15T13:30:00.000Z"),
          },
        ],
        now,
      })
    ).toBe(false);
  });

  it("rejects a slot outside opening hours", () => {
    expect(
      isBookableSlot({
        calendar: calendar(),
        startsAt: new Date("2026-06-15T02:00:00.000Z"), // 22:00 EDT the day before
        busy: [],
        now,
      })
    ).toBe(false);
  });
});

describe("monthGrid", () => {
  it("is always six weeks of seven days", () => {
    for (const [year, month] of [
      [2026, 1],
      [2026, 2],
      [2026, 8],
      [2027, 12],
    ] as const) {
      const weeks = monthGrid(year, month);
      expect(weeks).toHaveLength(6);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
    }
  });

  it("starts on the Sunday on or before the 1st", () => {
    // 2026-03-01 is a Sunday, so the grid starts exactly on it.
    expect(monthGrid(2026, 3)[0][0]).toBe("2026-03-01");
    // 2026-08-01 is a Saturday, so the grid backs up to 2026-07-26.
    expect(monthGrid(2026, 8)[0][0]).toBe("2026-07-26");
  });

  it("covers every day of the month exactly once", () => {
    const days = monthGrid(2026, 2).flat();
    // 2026 is not a leap year, so February ends on the 28th.
    expect(days).toContain("2026-02-01");
    expect(days).toContain("2026-02-28");
    expect(days).not.toContain("2026-02-29");
    expect(new Set(days).size).toBe(days.length);
  });

  it("includes 29 February in a leap year", () => {
    const days = monthGrid(2028, 2).flat();
    expect(days).toContain("2028-02-29");
  });

  it("runs consecutively with no gaps", () => {
    const days = monthGrid(2026, 8).flat();
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i]).toBe(addDays(days[i - 1], 1));
    }
  });

  it("pads with the neighbouring months, and monthOf can tell them apart", () => {
    const weeks = monthGrid(2026, 8);
    expect(monthOf(weeks[0][0])).toBe("2026-07");
    expect(monthOf("2026-08-15")).toBe("2026-08");
    expect(monthOf(weeks[5][6])).toBe("2026-09");
  });
});
