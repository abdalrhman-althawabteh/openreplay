"use client";

/**
 * Public Booking Widget
 *
 * Three steps in one card: pick a day, pick a time, leave your details.
 * Everything is shown in the visitor's own time zone — the server only ever
 * deals in UTC instants, and the zone the visitor saw is sent back with the
 * booking so the owner knows what time they think they agreed to.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HONEYPOT_FIELD } from "@/lib/honeypot";

type Props = {
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  /** Carries a form submission's answers onto the booking, when there is one. */
  submissionId?: string | null;
  prefill?: { name?: string; email?: string; phone?: string };
};

/** How many days the day-strip offers at once. */
const VISIBLE_DAYS = 14;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function BookingWidget({
  slug,
  name,
  description,
  durationMinutes,
  submissionId,
  prefill,
}: Props) {
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );

  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const [details, setDetails] = useState({
    name: prefill?.name ?? "",
    email: prefill?.email ?? "",
    phone: prefill?.phone ?? "",
    notes: "",
    [HONEYPOT_FIELD]: "",
  });

  const range = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() + weekOffset * VISIBLE_DAYS);
    const end = new Date(start);
    end.setDate(end.getDate() + VISIBLE_DAYS - 1);
    return { from: isoDate(start), to: isoDate(end) };
  }, [weekOffset]);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(`/api/public/calendar/${slug}?${params}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setSlots(data.data.slots);
      } else {
        setError(data.error ?? "Could not load available times");
      }
    } catch (err) {
      console.error("Failed to load slots:", err);
      setError("Could not load available times");
    } finally {
      setLoading(false);
    }
  }, [slug, range.from, range.to]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSlots();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSlots]);

  /** Slots grouped by the day they fall on *in the visitor's zone*. */
  const byDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const slot of slots) {
      const day = new Date(slot).toLocaleDateString("en-CA", { timeZone: timezone });
      const existing = groups.get(day);
      if (existing) existing.push(slot);
      else groups.set(day, [slot]);
    }
    return groups;
  }, [slots, timezone]);

  const days = useMemo(() => [...byDay.keys()].sort(), [byDay]);

  // Derived, not stored: the first day with availability is the default, and a
  // chosen day that the range no longer contains simply falls back to it.
  const activeDay =
    selectedDay && days.includes(selectedDay) ? selectedDay : days[0] ?? null;

  async function book() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/calendar/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: selectedSlot,
          timezone,
          submissionId: submissionId ?? undefined,
          ...details,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Could not book that time"
        );
        // Someone else took the slot while this visitor was typing.
        if (res.status === 409) {
          setSelectedSlot(null);
          await fetchSlots();
        }
        return;
      }
      setConfirmed(selectedSlot);
    } catch (err) {
      console.error("Failed to book:", err);
      setError("Could not book that time");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="panel rounded-lg p-8 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-2xl text-success">
          ✓
        </div>
        <h2 className="mt-5 text-xl font-semibold">You&rsquo;re booked</h2>
        <p className="mt-2 text-sm text-muted">
          {new Date(confirmed).toLocaleString("en-US", {
            timeZone: timezone,
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        <p className="mt-1 text-xs text-muted">{timezone}</p>
        <p className="mx-auto mt-6 max-w-sm text-sm text-muted">
          We&rsquo;ll review the details and get back to you to confirm.
        </p>
      </div>
    );
  }

  const daySlots = activeDay ? byDay.get(activeDay) ?? [] : [];

  return (
    <div className="panel overflow-hidden rounded-lg">
      <header className="border-b border-border px-6 py-6 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="mt-1.5 text-sm text-muted">
          {durationMinutes} minutes · times shown in {timezone}
        </p>
        {description && (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            {description}
          </p>
        )}
      </header>

      <div className="px-6 py-6 sm:px-8">
        {/* ── Step 1: the day ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Pick a day
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setWeekOffset((n) => Math.max(0, n - 1))}
              disabled={weekOffset === 0}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              Earlier
            </button>
            <button
              onClick={() => setWeekOffset((n) => n + 1)}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Later
            </button>
          </div>
        </div>

        {loading && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded bg-surface-hover" />
            ))}
          </div>
        )}

        {!loading && days.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            No times open in this stretch. Try &ldquo;Later&rdquo;.
          </p>
        )}

        {!loading && days.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {days.map((day) => {
              const date = new Date(`${day}T12:00:00`);
              const active = day === activeDay;
              return (
                <button
                  key={day}
                  onClick={() => {
                    setSelectedDay(day);
                    setSelectedSlot(null);
                  }}
                  className={`w-20 shrink-0 rounded-lg border px-2 py-3 text-center transition-colors ${
                    active
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-border-hover"
                  }`}
                >
                  <span className="block text-xs text-muted">
                    {date.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span
                    className={`mt-1 block text-lg font-semibold ${
                      active ? "text-accent" : ""
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  <span className="block text-xs text-muted">
                    {date.toLocaleDateString("en-US", { month: "short" })}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Step 2: the time ────────────────────────────────────────── */}
        {daySlots.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">
              Pick a time
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {daySlots.map((slot) => {
                const active = slot === selectedSlot;
                return (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-accent bg-accent text-white"
                        : "border-border hover:border-accent hover:text-accent"
                    }`}
                  >
                    {new Date(slot).toLocaleTimeString("en-US", {
                      timeZone: timezone,
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── Step 3: who you are ─────────────────────────────────────── */}
        {selectedSlot && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void book();
            }}
            className="mt-8 border-t border-border pt-6"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Your details
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm">Name</span>
                <input
                  required
                  value={details.name}
                  onChange={(e) =>
                    setDetails({ ...details, name: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm">Email</span>
                <input
                  required
                  type="email"
                  value={details.email}
                  onChange={(e) =>
                    setDetails({ ...details, email: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm">
                  Phone <span className="text-muted">(optional)</span>
                </span>
                <input
                  type="tel"
                  value={details.phone}
                  onChange={(e) =>
                    setDetails({ ...details, phone: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm">
                  Anything we should know?{" "}
                  <span className="text-muted">(optional)</span>
                </span>
                <textarea
                  rows={3}
                  value={details.notes}
                  onChange={(e) =>
                    setDetails({ ...details, notes: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                />
              </label>
            </div>

            {/* Bots fill every input they find; people never see this one. */}
            <input
              type="text"
              name={HONEYPOT_FIELD}
              value={details[HONEYPOT_FIELD]}
              onChange={(e) =>
                setDetails({ ...details, [HONEYPOT_FIELD]: e.target.value })
              }
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />

            {error && (
              <p className="mt-4 rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-auto sm:px-8"
            >
              {submitting
                ? "Booking…"
                : `Book ${new Date(selectedSlot).toLocaleString("en-US", {
                    timeZone: timezone,
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`}
            </button>
          </form>
        )}

        {!selectedSlot && error && (
          <p className="mt-4 rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
