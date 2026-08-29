/**
 * Booking slot generation.
 *
 * A calendar's opening hours are wall-clock times in the owner's own IANA zone
 * ("Mon 09:00–17:00 in Asia/Amman"). Bookings are stored as UTC instants. This
 * module is the bridge between the two, and the only place in the app that
 * knows how to turn one into the other.
 *
 * ponytail: no date library. `Intl` already carries the full IANA database, so
 * date-fns-tz / luxon would only wrap what the platform does natively.
 */

import { z } from "zod";

/** "HH:mm", 24-hour. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** "YYYY-MM-DD". */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const timeStringSchema = z.string().regex(TIME_PATTERN, "Use HH:mm");
export const dateStringSchema = z
  .string()
  .regex(DATE_PATTERN, "Use YYYY-MM-DD");

export const availabilityWindowSchema = z
  .tuple([timeStringSchema, timeStringSchema])
  .refine(([start, end]) => toMinutes(start) < toMinutes(end), {
    message: "A window must end after it starts",
  });

/**
 * Weekly opening hours keyed by weekday, "0" = Sunday .. "6" = Saturday.
 * A missing or empty key means the calendar is closed that day.
 */
export const availabilitySchema = z.record(
  // A regex key rather than z.enum, so every weekday stays optional — a
  // z.enum key would make all seven required.
  z.string().regex(/^[0-6]$/, "Weekday must be 0-6"),
  z.array(availabilityWindowSchema).max(4)
);

export type AvailabilityWindow = [string, string];
export type Availability = Partial<Record<string, AvailabilityWindow[]>>;

export type SlotCalendar = {
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  availability: Availability;
};

export type BusyInterval = { startsAt: Date; endsAt: Date };

/** Hard ceiling on how many days one request may expand, whatever it asks for. */
const MAX_DAYS_PER_REQUEST = 62;

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * How far `timeZone` is ahead of UTC at a given instant, in milliseconds.
 *
 * Formats the instant into the zone, then reads those wall-clock parts back as
 * if they were UTC. The difference is the offset — DST included, because the
 * formatter applies whichever rule was in force at that instant.
 */
function offsetMsAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // hour12:false renders midnight as "24" in some locales; the day part is
    // already correct, so fold it back to 0.
    read("hour") % 24,
    read("minute"),
    read("second")
  );

  return asIfUtc - instant;
}

/**
 * Resolve a wall-clock time in an IANA zone to the UTC instant it names.
 *
 * Two passes: the first guess uses the offset in force at the *wrong* instant,
 * which is off by an hour when the guess lands on the other side of a DST
 * change. Re-reading the offset at the corrected instant fixes it.
 */
export function zonedTimeToUtc(
  dateISO: string,
  time: string,
  timeZone: string
): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);

  const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const firstPass = wallAsUtc - offsetMsAt(wallAsUtc, timeZone);
  return new Date(wallAsUtc - offsetMsAt(firstPass, timeZone));
}

/** The calendar date it currently is in `timeZone`, as "YYYY-MM-DD". */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** 0 = Sunday. A date string names one weekday regardless of any zone. */
export function weekdayOf(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * A month laid out as calendar weeks of ISO date strings.
 *
 * Always six rows of seven, padded with the tail of the previous month and the
 * head of the next, so the grid never changes height as you page through
 * months. `month` is 1-12.
 */
export function monthGrid(year: number, month: number): string[][] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // Back up to the Sunday on or before the 1st.
  const start = new Date(
    Date.UTC(year, month - 1, 1 - firstOfMonth.getUTCDay())
  );
  const startISO = start.toISOString().slice(0, 10);

  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push(addDays(startISO, week * 7 + day));
    }
    weeks.push(days);
  }
  return weeks;
}

/** The month a date string belongs to, as "YYYY-MM". */
export function monthOf(dateISO: string) {
  return dateISO.slice(0, 7);
}

/**
 * Every bookable start time on `calendar` between two calendar dates.
 *
 * `busy` is the calendar's existing non-cancelled bookings. The buffer applies
 * both between consecutive slots and around an existing booking, so a 30-minute
 * call with a 15-minute buffer really does leave 15 minutes on each side.
 */
export function generateSlots({
  calendar,
  fromISO,
  toISO,
  busy = [],
  now = new Date(),
}: {
  calendar: SlotCalendar;
  fromISO: string;
  toISO: string;
  busy?: BusyInterval[];
  now?: Date;
}): Date[] {
  const durationMs = calendar.durationMinutes * 60_000;
  const bufferMs = calendar.bufferMinutes * 60_000;
  if (durationMs <= 0) return [];

  const earliest = now.getTime() + calendar.minNoticeHours * 3_600_000;
  const latest = now.getTime() + calendar.maxDaysAhead * 86_400_000;

  // Never look further back than today in the calendar's own zone: yesterday's
  // slots are not bookable no matter what the caller asks for.
  const start =
    fromISO < todayInZone(calendar.timezone, now)
      ? todayInZone(calendar.timezone, now)
      : fromISO;

  const slots: Date[] = [];

  for (let i = 0; i < MAX_DAYS_PER_REQUEST; i += 1) {
    const dateISO = addDays(start, i);
    if (dateISO > toISO) break;

    const windows = calendar.availability[String(weekdayOf(dateISO))] ?? [];

    for (const [openTime, closeTime] of windows) {
      const opens = zonedTimeToUtc(dateISO, openTime, calendar.timezone).getTime();
      const closes = zonedTimeToUtc(
        dateISO,
        closeTime,
        calendar.timezone
      ).getTime();

      for (
        let slotStart = opens;
        slotStart + durationMs <= closes;
        slotStart += durationMs + bufferMs
      ) {
        if (slotStart < earliest || slotStart > latest) continue;

        const slotEnd = slotStart + durationMs;
        const collides = busy.some(
          (booking) =>
            slotStart < booking.endsAt.getTime() + bufferMs &&
            booking.startsAt.getTime() - bufferMs < slotEnd
        );
        if (collides) continue;

        slots.push(new Date(slotStart));
      }
    }
  }

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Whether a proposed booking is a real slot on this calendar. The public
 * booking endpoint calls this instead of trusting the time the browser sent.
 */
export function isBookableSlot({
  calendar,
  startsAt,
  busy,
  now = new Date(),
}: {
  calendar: SlotCalendar;
  startsAt: Date;
  busy: BusyInterval[];
  now?: Date;
}): boolean {
  const dateISO = todayInZone(calendar.timezone, startsAt);
  const slots = generateSlots({
    calendar,
    // A slot can open on the day before or after in the calendar's zone once
    // the visitor's offset is applied, so check a three-day window.
    fromISO: addDays(dateISO, -1),
    toISO: addDays(dateISO, 1),
    busy,
    now,
  });
  return slots.some((slot) => slot.getTime() === startsAt.getTime());
}
