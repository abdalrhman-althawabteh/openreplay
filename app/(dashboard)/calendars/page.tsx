"use client";

/**
 * Calendars Page
 *
 * One card per booking calendar, each with its public link and how many
 * bookings are still waiting for a decision.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface CalendarSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  durationMinutes: number;
  isActive: boolean;
  pendingBookings: number;
  _count: { bookings: number };
}

export default function CalendarsPage() {
  const router = useRouter();
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCalendars = useCallback(async () => {
    try {
      const res = await fetch("/api/calendars", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setCalendars(data.data);
      } else {
        setError(data.error ?? "Failed to load calendars");
      }
    } catch (err) {
      console.error("Failed to fetch calendars:", err);
      setError("Failed to load calendars");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCalendars();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCalendars]);

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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">
          Each calendar has its own public booking page. Share the link, and the
          bookings land here for you to confirm or cancel.
        </p>
        <button
          onClick={createCalendar}
          disabled={creating}
          className="shrink-0 self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {creating ? "Creating…" : "New calendar"}
        </button>
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="panel h-32 rounded" />
          ))}
        </div>
      )}

      {!loading && calendars.length === 0 && (
        <div className="panel rounded p-12 text-center">
          <p className="text-sm text-muted">
            No calendars yet. Create one, set your weekly hours, and share the
            booking link.
          </p>
        </div>
      )}

      {!loading && calendars.length > 0 && (
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

              {calendar.description && (
                <p className="mt-3 line-clamp-2 text-sm text-muted">
                  {calendar.description}
                </p>
              )}

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
                  Open
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
    </div>
  );
}
