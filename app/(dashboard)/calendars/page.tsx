"use client";

/**
 * Calendars
 *
 * Three views over the same thing, switched by ?view= so a view can be linked
 * and survives a refresh: the appointment list (the default — what needs a
 * decision), the month grid, and the calendars themselves.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppointmentCalendar from "@/components/appointment-calendar";
import AppointmentDetails from "@/components/appointment-details";
import AppointmentTable, { type Scope } from "@/components/appointment-table";
import { monthGrid } from "@/lib/calendars/slots";
import type { Booking, BookingStatus } from "@/lib/bookings";

interface CalendarSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  durationMinutes: number;
  isActive: boolean;
  pendingBookings: number;
  form: { id: string; name: string } | null;
  _count: { bookings: number };
}

type View = "list" | "grid" | "calendars";

const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "Appointments" },
  { key: "grid", label: "Calendar view" },
  { key: "calendars", label: "Calendars" },
];

export default function CalendarsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const view: View = VIEWS.some((v) => v.key === viewParam)
    ? (viewParam as View)
    : "list";

  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [scope, setScope] = useState<Scope>("upcoming");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);

  const viewerTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );

  function setView(next: View) {
    router.replace(next === "list" ? "/calendars" : `/calendars?view=${next}`);
  }

  const fetchCalendars = useCallback(async () => {
    try {
      const res = await fetch("/api/calendars", { cache: "no-store" });
      const data = await res.json();
      if (data.success) setCalendars(data.data);
      else setError(data.error ?? "Failed to load calendars");
    } catch (err) {
      console.error("Failed to fetch calendars:", err);
      setError("Failed to load calendars");
    } finally {
      setCalendarsLoading(false);
    }
  }, []);

  const fetchBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (view === "grid") {
        // The whole visible grid, so bookings on the padding days show too.
        const [year, monthNumber] = month.split("-").map(Number);
        const grid = monthGrid(year, monthNumber);
        params.set("from", grid[0][0]);
        // `to` is exclusive, so reach one day past the last cell.
        params.set("to", monthGrid(year, monthNumber + 1)[0][0]);
        params.set("scope", "all");
      } else {
        params.set("scope", scope);
      }

      const res = await fetch(`/api/bookings?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setBookings(data.data.bookings);
      else setError(data.error ?? "Failed to load appointments");
    } catch (err) {
      console.error("Failed to fetch bookings:", err);
      setError("Failed to load appointments");
    } finally {
      setBookingsLoading(false);
    }
  }, [view, scope, month]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCalendars();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCalendars]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchBookings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchBookings]);

  function replaceBooking(updated: Booking) {
    setBookings((prev) =>
      prev.map((b) => (b.id === updated.id ? updated : b))
    );
    setOpenBooking((cur) => (cur?.id === updated.id ? updated : cur));
    // A decision changes the "awaiting your decision" count on the cards.
    void fetchCalendars();
  }

  function removeBooking(id: string) {
    setBookings((prev) => prev.filter((b) => b.id !== id));
    void fetchCalendars();
  }

  async function changeStatus(booking: Booking, status: BookingStatus) {
    setError(null);
    try {
      const res = await fetch(`/api/bookings?id=${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Could not change that status");
        return;
      }
      // Cancelling drops the row out of "Upcoming", so refetch rather than
      // leaving a row on screen that no longer belongs to the current tab.
      if (view === "list" && scope !== "all") await fetchBookings();
      else replaceBooking(data.data);
    } catch (err) {
      console.error("Failed to change status:", err);
      setError("Could not change that status");
    }
  }

  async function deleteBooking(booking: Booking) {
    if (!confirm("Delete this appointment? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/bookings?id=${booking.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Could not delete that");
        return;
      }
      removeBooking(booking.id);
    } catch (err) {
      console.error("Failed to delete booking:", err);
      setError("Could not delete that");
    }
  }

  async function createCalendar() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New calendar",
          // Start in the browser's own zone — almost always the right guess,
          // and editable on the next screen.
          timezone: viewerTimezone,
          availability: {
            "1": [["09:00", "17:00"]],
            "2": [["09:00", "17:00"]],
            "3": [["09:00", "17:00"]],
            "4": [["09:00", "17:00"]],
            "5": [["09:00", "17:00"]],
          },
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to create calendar");
        return;
      }
      router.push(`/calendars/${data.data.id}`);
    } catch (err) {
      console.error("Failed to create calendar:", err);
      setError("Failed to create calendar");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink(calendar: CalendarSummary) {
    const url = `${window.location.origin}/book/${calendar.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(calendar.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard is blocked outside a secure context; show the URL instead so
      // it can still be copied by hand.
      prompt("Copy this booking link:", url);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-surface p-1">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                view === item.key
                  ? "bg-background font-medium text-foreground ring-1 ring-accent/40"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {view === "calendars" && (
          <button
            onClick={createCalendar}
            disabled={creating}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? "Creating…" : "New calendar"}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {view === "list" && (
        <AppointmentTable
          bookings={bookings}
          loading={bookingsLoading}
          scope={scope}
          onScopeChange={setScope}
          viewerTimezone={viewerTimezone}
          onOpen={setOpenBooking}
          onStatusChange={changeStatus}
          onDelete={deleteBooking}
        />
      )}

      {view === "grid" && (
        <AppointmentCalendar
          bookings={bookings}
          loading={bookingsLoading}
          month={month}
          onMonthChange={setMonth}
          viewerTimezone={viewerTimezone}
          onOpen={setOpenBooking}
        />
      )}

      {view === "calendars" && (
        <>
          <p className="max-w-2xl text-sm text-muted">
            Each calendar has its own public booking page. Attach a form to it
            and the link asks your questions and takes a booking in one go.
          </p>

          {calendarsLoading && (
            <div className="grid gap-4 sm:grid-cols-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="panel h-32 rounded" />
              ))}
            </div>
          )}

          {!calendarsLoading && calendars.length === 0 && (
            <div className="panel rounded p-12 text-center">
              <p className="text-sm text-muted">
                No calendars yet. Create one, set your weekly hours, and share
                the booking link.
              </p>
            </div>
          )}

          {!calendarsLoading && calendars.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {calendars.map((calendar) => (
                <div key={calendar.id} className="panel rounded p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/calendars/${calendar.id}`}
                        className="block truncate text-base font-semibold hover:text-accent"
                      >
                        {calendar.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted">
                        {calendar.durationMinutes} min · {calendar.timezone}
                      </p>
                    </div>
                    {!calendar.isActive && (
                      <span className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-muted">
                        Off
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-sm text-muted">
                    {calendar.form ? (
                      <>
                        Asks{" "}
                        <span className="text-foreground">
                          {calendar.form.name}
                        </span>{" "}
                        before booking
                      </>
                    ) : (
                      "No form attached"
                    )}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-muted">
                      {calendar._count.bookings} booking
                      {calendar._count.bookings === 1 ? "" : "s"}
                    </span>
                    {calendar.pendingBookings > 0 && (
                      <span className="font-medium text-accent">
                        {calendar.pendingBookings} awaiting your decision
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/calendars/${calendar.id}`}
                      className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => copyLink(calendar)}
                      className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      {copiedId === calendar.id ? "Copied" : "Copy booking link"}
                    </button>
                    <a
                      href={`/book/${calendar.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      Preview
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <AppointmentDetails
        key={openBooking?.id ?? "none"}
        booking={openBooking}
        viewerTimezone={viewerTimezone}
        onClose={() => setOpenBooking(null)}
        onChanged={replaceBooking}
        onDeleted={removeBooking}
      />
    </div>
  );
}
