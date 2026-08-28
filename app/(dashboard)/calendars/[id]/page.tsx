"use client";

/**
 * Calendar Detail
 *
 * Two halves: the calendar's settings, and the bookings people have made on
 * it. A booking arrives as Pending — this is where it gets confirmed or
 * cancelled after reading what the person told you.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CalendarHoursEditor from "@/components/calendar-hours-editor";
import type { Availability } from "@/lib/calendars/slots";

interface Calendar {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  availability: Availability;
  isActive: boolean;
}

interface Booking {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  notes: string | null;
  answers: Record<string, string | string[]> | null;
  createdAt: string;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
  };
  calendar: { id: string; name: string; timezone: string };
}

const STATUS_FILTERS = ["PENDING", "CONFIRMED", "CANCELLED", "ALL"] as const;

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-warning/30 bg-warning/10 text-warning",
  CONFIRMED: "border-success/30 bg-success/10 text-success",
  CANCELLED: "border-border bg-surface text-muted",
};

const fieldClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm";

function formatSlot(isoString: string, timeZone: string) {
  return new Date(isoString).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CalendarDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const calendarId = params.id;

  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("PENDING");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The owner's own zone, for showing what time a booking is for them.
  const [viewerTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  );

  const fetchCalendar = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendars?id=${calendarId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setCalendar(data.data);
      } else {
        setError(data.error ?? "Failed to load calendar");
      }
    } catch (err) {
      console.error("Failed to fetch calendar:", err);
      setError("Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [calendarId]);

  const fetchBookings = useCallback(async () => {
    try {
      const params = new URLSearchParams({ calendarId, limit: "100" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(`/api/bookings?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setBookings(data.data.bookings);
    } catch (err) {
      console.error("Failed to fetch bookings:", err);
    }
  }, [calendarId, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCalendar();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCalendar]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchBookings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchBookings]);

  function patchCalendar(changes: Partial<Calendar>) {
    setSaved(false);
    setCalendar((prev) => (prev ? { ...prev, ...changes } : prev));
  }

  async function saveCalendar() {
    if (!calendar) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendars?id=${calendar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: calendar.name,
          description: calendar.description,
          timezone: calendar.timezone,
          durationMinutes: calendar.durationMinutes,
          bufferMinutes: calendar.bufferMinutes,
          minNoticeHours: calendar.minNoticeHours,
          maxDaysAhead: calendar.maxDaysAhead,
          availability: calendar.availability,
          isActive: calendar.isActive,
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
            : data.error ?? "Failed to save calendar"
        );
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save calendar:", err);
      setError("Failed to save calendar");
    } finally {
      setSaving(false);
    }
  }

  async function setBookingStatus(booking: Booking, status: Booking["status"]) {
    try {
      const res = await fetch(`/api/bookings?id=${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to update booking");
        return;
      }
      // The list is filtered by status, so a decision usually removes the row
      // from view — refetch rather than patching it in place.
      await fetchBookings();
    } catch (err) {
      console.error("Failed to update booking:", err);
      setError("Failed to update booking");
    }
  }

  async function deleteCalendar() {
    if (!calendar) return;
    if (
      !confirm(
        `Delete "${calendar.name}"? Every booking on it goes too, and the public link stops working. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/calendars?id=${calendar.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to delete calendar");
        return;
      }
      router.push("/calendars");
      router.refresh();
    } catch (err) {
      console.error("Failed to delete calendar:", err);
      setError("Failed to delete calendar");
    }
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (!calendar) {
    return (
      <div className="panel rounded p-12 text-center">
        <p className="text-sm text-muted">{error ?? "Calendar not found."}</p>
        <Link
          href="/calendars"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Back to calendars
        </Link>
      </div>
    );
  }

  const bookingUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/book/${calendar.slug}`
      : `/book/${calendar.slug}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/calendars" className="text-sm text-muted hover:text-foreground">
          ← Calendars
        </Link>
        <a
          href={`/book/${calendar.slug}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto truncate rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          {bookingUrl}
        </a>
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        {/* ── Settings ─────────────────────────────────────────────────── */}
        <div className="panel space-y-5 rounded p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Settings
          </h2>

          <label className="block">
            <span className="mb-1.5 block text-sm">Name</span>
            <input
              value={calendar.name}
              onChange={(e) => patchCalendar({ name: e.target.value })}
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm">
              Description{" "}
              <span className="text-muted">— shown on the booking page</span>
            </span>
            <textarea
              value={calendar.description ?? ""}
              onChange={(e) => patchCalendar({ description: e.target.value })}
              rows={2}
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm">Time zone</span>
            <select
              value={calendar.timezone}
              onChange={(e) => patchCalendar({ timezone: e.target.value })}
              className={fieldClass}
            >
              {/* The runtime ships the full IANA list, so there is no reason to
                  hardcode a shortlist that would go stale. */}
              {Intl.supportedValuesOf("timeZone").map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm">Length (min)</span>
              <input
                type="number"
                min={5}
                max={480}
                value={calendar.durationMinutes}
                onChange={(e) =>
                  patchCalendar({ durationMinutes: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm">Gap between (min)</span>
              <input
                type="number"
                min={0}
                max={240}
                value={calendar.bufferMinutes}
                onChange={(e) =>
                  patchCalendar({ bufferMinutes: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm">Notice (hours)</span>
              <input
                type="number"
                min={0}
                max={720}
                value={calendar.minNoticeHours}
                onChange={(e) =>
                  patchCalendar({ minNoticeHours: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm">Book up to (days)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={calendar.maxDaysAhead}
                onChange={(e) =>
                  patchCalendar({ maxDaysAhead: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
          </div>

          <div>
            <span className="mb-2 block text-sm">Weekly hours</span>
            <CalendarHoursEditor
              value={calendar.availability}
              onChange={(availability) => patchCalendar({ availability })}
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={calendar.isActive}
              onChange={(e) => patchCalendar({ isActive: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Accepting bookings
          </label>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <button
              onClick={saveCalendar}
              disabled={saving}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm text-success">Saved</span>}
            <button
              onClick={deleteCalendar}
              className="ml-auto text-sm text-muted hover:text-error"
            >
              Delete calendar
            </button>
          </div>
        </div>

        {/* ── Bookings ─────────────────────────────────────────────────── */}
        <div className="panel rounded p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Bookings
            </h2>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    statusFilter === status
                      ? "border border-accent/20 bg-accent/15 text-accent"
                      : "border border-border bg-surface text-muted hover:border-border-hover hover:text-foreground"
                  }`}
                >
                  {status === "ALL"
                    ? "All"
                    : status.charAt(0) + status.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {bookings.length === 0 && (
            <p className="py-12 text-center text-sm text-muted">
              {statusFilter === "PENDING"
                ? "Nothing waiting on you."
                : "No bookings here yet."}
            </p>
          )}

          <div className="mt-4 divide-y divide-border">
            {bookings.map((booking) => {
              const expanded = expandedId === booking.id;
              const answers = booking.answers
                ? Object.entries(booking.answers)
                : [];

              return (
                <div key={booking.id} className="py-4 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {booking.contact.name ??
                          booking.contact.email ??
                          "Someone"}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatSlot(booking.startsAt, viewerTimezone)}
                        <span className="text-xs"> (your time)</span>
                      </p>
                      {booking.timezone !== viewerTimezone && (
                        <p className="text-xs text-muted">
                          {formatSlot(booking.startsAt, booking.timezone)} ·{" "}
                          {booking.timezone}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded border px-2 py-0.5 text-xs ${
                        STATUS_STYLES[booking.status]
                      }`}
                    >
                      {booking.status.charAt(0) +
                        booking.status.slice(1).toLowerCase()}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    {booking.contact.email && <span>{booking.contact.email}</span>}
                    {booking.contact.phone && <span>{booking.contact.phone}</span>}
                    {booking.contact.country && (
                      <span>{booking.contact.country}</span>
                    )}
                  </div>

                  {(booking.notes || answers.length > 0) && (
                    <button
                      onClick={() => setExpandedId(expanded ? null : booking.id)}
                      className="mt-2 text-xs text-muted hover:text-foreground"
                    >
                      {expanded ? "Hide answers" : "Show what they told you"}
                    </button>
                  )}

                  {expanded && (
                    <div className="mt-3 space-y-2 rounded border border-border bg-background p-3 text-sm">
                      {booking.notes && (
                        <p>
                          <span className="text-muted">Notes: </span>
                          {booking.notes}
                        </p>
                      )}
                      {answers.map(([label, value]) => (
                        <p key={label}>
                          <span className="text-muted">{label}: </span>
                          {Array.isArray(value) ? value.join(", ") : value}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {booking.status !== "CONFIRMED" && (
                      <button
                        onClick={() => setBookingStatus(booking, "CONFIRMED")}
                        className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                      >
                        Confirm
                      </button>
                    )}
                    {booking.status !== "CANCELLED" && (
                      <button
                        onClick={() => setBookingStatus(booking, "CANCELLED")}
                        className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-error"
                      >
                        Cancel
                      </button>
                    )}
                    {booking.status === "CANCELLED" && (
                      <button
                        onClick={() => setBookingStatus(booking, "PENDING")}
                        className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
