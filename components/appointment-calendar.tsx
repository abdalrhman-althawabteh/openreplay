"use client";

/**
 * Appointment Calendar View
 *
 * The same bookings as the table, laid out on a month so a busy week is
 * obvious at a glance. Days are grouped in the owner's own time zone — this is
 * their working calendar, not the visitor's.
 */

import { monthGrid, monthOf } from "@/lib/calendars/slots";
import {
  STATUS_STYLES,
  bookingTitle,
  type Booking,
} from "@/lib/bookings";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AppointmentCalendar({
  bookings,
  loading,
  month,
  onMonthChange,
  viewerTimezone,
  onOpen,
}: {
  bookings: Booking[];
  loading: boolean;
  /** "YYYY-MM" */
  month: string;
  onMonthChange: (month: string) => void;
  viewerTimezone: string;
  onOpen: (booking: Booking) => void;
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const weeks = monthGrid(year, monthNumber);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: viewerTimezone,
  });

  const byDay = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const day = new Date(booking.startsAt).toLocaleDateString("en-CA", {
      timeZone: viewerTimezone,
    });
    const existing = byDay.get(day);
    if (existing) existing.push(booking);
    else byDay.set(day, [booking]);
  }

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    onMonthChange(next.toISOString().slice(0, 7));
  }

  return (
    <div className="panel rounded p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          {new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(
            "en-US",
            { month: "long", year: "numeric", timeZone: "UTC" }
          )}
        </h2>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-muted">Loading…</span>}
          <button
            onClick={() =>
              onMonthChange(new Date().toISOString().slice(0, 7))
            }
            className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            Today
          </button>
          <button
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            ←
          </button>
          <button
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            →
          </button>
        </div>
      </div>

      {/* Seven columns don't fit a phone, so the grid keeps its width and
          scrolls sideways rather than crushing every day into nothing. */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="pb-2 text-center text-xs font-medium text-muted"
              >
                {day}
              </div>
            ))}

            {weeks.flat().map((day) => {
              const dayBookings = byDay.get(day) ?? [];
              const inMonth = monthOf(day) === month;

              return (
                <div
                  key={day}
                  className={`min-h-24 rounded-lg border p-1.5 ${
                    day === today
                      ? "border-accent bg-accent/5"
                      : "border-border"
                  } ${inMonth ? "" : "opacity-40"}`}
                >
                  <span
                    className={`block px-0.5 text-xs ${
                      day === today
                        ? "font-semibold text-accent"
                        : "text-muted"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </span>

                  <div className="mt-1 space-y-1">
                    {dayBookings.map((booking) => (
                      <button
                        key={booking.id}
                        onClick={() => onOpen(booking)}
                        title={`${bookingTitle(booking)} — ${booking.calendar.name}`}
                        className={`block w-full truncate rounded border px-1.5 py-1 text-left text-[11px] leading-tight ${
                          STATUS_STYLES[booking.status]
                        } ${booking.status === "CANCELLED" ? "line-through" : ""}`}
                      >
                        {new Date(booking.startsAt).toLocaleTimeString("en-US", {
                          timeZone: viewerTimezone,
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        {bookingTitle(booking)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        Times shown in {viewerTimezone}.
      </p>
    </div>
  );
}
