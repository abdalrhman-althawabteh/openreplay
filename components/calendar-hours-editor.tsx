"use client";

/**
 * Weekly Hours Editor
 *
 * One row per weekday, each holding up to four open windows so a day can be
 * split around lunch. Times use the native <input type="time"> — it already
 * gives a 24-hour value, a picker on mobile, and keyboard support for free.
 */

import type { Availability, AvailabilityWindow } from "@/lib/calendars/slots";

const DAYS = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" },
];

const DEFAULT_WINDOW: AvailabilityWindow = ["09:00", "17:00"];
const MAX_WINDOWS = 4;

export default function CalendarHoursEditor({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
}) {
  function setDay(dayKey: string, windows: AvailabilityWindow[]) {
    const next = { ...value };
    if (windows.length === 0) {
      delete next[dayKey];
    } else {
      next[dayKey] = windows;
    }
    onChange(next);
  }

  function setTime(
    dayKey: string,
    index: number,
    edge: 0 | 1,
    time: string
  ) {
    const windows = [...(value[dayKey] ?? [])];
    const window: AvailabilityWindow = [...windows[index]];
    window[edge] = time;
    windows[index] = window;
    setDay(dayKey, windows);
  }

  return (
    <div className="space-y-1">
      {DAYS.map(({ key, label }) => {
        const windows = value[key] ?? [];
        const isOpen = windows.length > 0;

        return (
          <div
            key={key}
            className="flex flex-col gap-3 border-b border-border py-3 last:border-0 sm:flex-row sm:items-start"
          >
            <label className="flex w-40 shrink-0 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={isOpen}
                onChange={(e) =>
                  setDay(key, e.target.checked ? [DEFAULT_WINDOW] : [])
                }
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span
                className={isOpen ? "font-medium text-foreground" : "text-muted"}
              >
                {label}
              </span>
            </label>

            {!isOpen && (
              <p className="self-center text-sm text-muted">Closed</p>
            )}

            {isOpen && (
              <div className="flex-1 space-y-2">
                {windows.map((window, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      value={window[0]}
                      onChange={(e) => setTime(key, index, 0, e.target.value)}
                      className="rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                    <span className="text-sm text-muted">to</span>
                    <input
                      type="time"
                      value={window[1]}
                      onChange={(e) => setTime(key, index, 1, e.target.value)}
                      className="rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                    {windows.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDay(
                            key,
                            windows.filter((_, i) => i !== index)
                          )
                        }
                        className="text-xs text-muted hover:text-error"
                      >
                        Remove
                      </button>
                    )}
                    {window[0] >= window[1] && (
                      <span className="text-xs text-error">
                        Must end after it starts
                      </span>
                    )}
                  </div>
                ))}

                {windows.length < MAX_WINDOWS && (
                  <button
                    type="button"
                    onClick={() => setDay(key, [...windows, ["13:00", "17:00"]])}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    + Add another window
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
