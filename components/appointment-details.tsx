"use client";

/**
 * Appointment Details
 *
 * A slide-over on the right holding everything about one booking: who they are,
 * when it is in both time zones, everything they told you on the form, your own
 * notes, and the status. Contact details themselves are edited in Contacts —
 * this panel is about the appointment.
 */

import { useEffect, useState } from "react";
import type { Booking, BookingStatus } from "@/lib/bookings";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/bookings";

export default function AppointmentDetails({
  booking,
  viewerTimezone,
  onClose,
  onChanged,
  onDeleted,
}: {
  booking: Booking | null;
  viewerTimezone: string;
  onClose: () => void;
  onChanged: (booking: Booking) => void;
  onDeleted: (id: string) => void;
}) {
  // The parent keys this component by booking id, so opening a different
  // appointment remounts it and these start fresh — no reset effect needed.
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [booking, onClose]);

  if (!booking) return null;

  const answers = booking.answers ? Object.entries(booking.answers) : [];

  async function patch(body: Record<string, unknown>) {
    if (!booking) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings?id=${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Could not save that");
        return;
      }
      onChanged(data.data);
    } catch (err) {
      console.error("Failed to update booking:", err);
      setError("Could not save that");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!booking) return;
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
      onDeleted(booking.id);
      onClose();
    } catch (err) {
      console.error("Failed to delete booking:", err);
      setError("Could not delete that");
    }
  }

  function formatIn(timeZone: string) {
    return new Date(booking!.startsAt).toLocaleString("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      <aside
        role="dialog"
        aria-label="Appointment details"
        className="fixed top-0 right-0 z-50 flex h-dvh w-[28rem] max-w-[92vw] flex-col border-l border-border bg-background"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {booking.contact.name ?? booking.contact.email ?? "Someone"}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{booking.calendar.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-lg leading-none text-muted hover:text-foreground"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              When
            </h3>
            <p className="mt-2 text-sm font-medium">
              {formatIn(viewerTimezone)}
            </p>
            <p className="text-xs text-muted">Your time · {viewerTimezone}</p>
            {booking.timezone !== viewerTimezone && (
              <>
                <p className="mt-2 text-sm">{formatIn(booking.timezone)}</p>
                <p className="text-xs text-muted">
                  Their time · {booking.timezone}
                </p>
              </>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Contact
            </h3>
            <div className="mt-2 space-y-1 text-sm">
              {booking.contact.email && <p>{booking.contact.email}</p>}
              {booking.contact.phone && <p>{booking.contact.phone}</p>}
              {booking.contact.country && (
                <p className="text-muted">{booking.contact.country}</p>
              )}
            </div>
          </section>

          {answers.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                What they told you
              </h3>
              <dl className="mt-2 space-y-3 text-sm">
                {answers.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-0.5">
                      {Array.isArray(value) ? value.join(", ") : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Your notes
            </h3>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (booking.notes ?? "")) void patch({ notes });
              }}
              placeholder="Only you see this"
              className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </section>

          {error && (
            <p className="rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
        </div>

        <footer className="space-y-3 border-t border-border px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Status
            </span>
            <select
              value={booking.status}
              disabled={saving}
              onChange={(e) =>
                void patch({ status: e.target.value as BookingStatus })
              }
              className={`w-full rounded border px-3 py-2 text-sm ${
                STATUS_STYLES[booking.status]
              }`}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={remove}
            className="w-full rounded border border-border px-3 py-2 text-sm text-muted hover:text-error"
          >
            Delete appointment
          </button>
        </footer>
      </aside>
    </>
  );
}
