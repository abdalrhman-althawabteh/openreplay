"use client";

/**
 * Appointment List View
 *
 * Every booking as a row, with the status changeable in place — the common
 * case is reading who booked and deciding, so that shouldn't need a panel.
 */

import { useEffect, useState } from "react";
import {
  STATUS_LABELS,
  STATUS_STYLES,
  bookingTitle,
  type Booking,
  type BookingStatus,
} from "@/lib/bookings";

export type Scope = "upcoming" | "cancelled" | "all";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

export default function AppointmentTable({
  bookings,
  loading,
  scope,
  onScopeChange,
  viewerTimezone,
  onOpen,
  onStatusChange,
  onDelete,
}: {
  bookings: Booking[];
  loading: boolean;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  viewerTimezone: string;
  onOpen: (booking: Booking) => void;
  onStatusChange: (booking: Booking, status: BookingStatus) => void;
  onDelete: (booking: Booking) => void;
}) {
  // The table scrolls sideways inside a rounded panel, and that clipping
  // context would cut an absolutely-positioned menu off at the panel edge. So
  // the menu is anchored to the viewport instead, from the button's own rect.
  const [menu, setMenu] = useState<{
    id: string;
    top: number;
    right: number;
  } | null>(null);

  // The backdrop below closes the menu on a click; this covers the keyboard.
  // Scrolling closes it too, since a viewport-anchored menu would otherwise
  // drift away from the row it belongs to.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            onClick={() => onScopeChange(item.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              scope === item.key
                ? "border border-accent/20 bg-accent/15 text-accent"
                : "border border-border bg-surface text-muted hover:border-border-hover hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["#", "Contact", "Status", "Appointment time", "Calendar", ""].map(
                  (heading, i) => (
                    <th
                      key={i}
                      className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6"
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-4 sm:px-6">
                      <div className="h-4 rounded bg-surface-hover" />
                    </td>
                  </tr>
                ))}

              {!loading && bookings.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-muted sm:px-6"
                  >
                    {scope === "upcoming"
                      ? "Nothing booked yet. Share a calendar link and they'll appear here."
                      : "No appointments here."}
                  </td>
                </tr>
              )}

              {!loading &&
                bookings.map((booking, index) => (
                  <tr
                    key={booking.id}
                    className="transition-colors hover:bg-surface-hover/50"
                  >
                    <td className="px-4 py-4 text-muted sm:px-6">{index + 1}</td>

                    <td className="px-4 py-4 sm:px-6">
                      <button
                        onClick={() => onOpen(booking)}
                        className="block max-w-[220px] truncate text-left font-medium hover:text-accent"
                      >
                        {bookingTitle(booking)}
                      </button>
                      {booking.contact.email && (
                        <span className="mt-0.5 block max-w-[220px] truncate text-xs text-muted">
                          {booking.contact.email}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4 sm:px-6">
                      <select
                        value={booking.status}
                        onChange={(e) =>
                          onStatusChange(
                            booking,
                            e.target.value as BookingStatus
                          )
                        }
                        className={`rounded border px-2.5 py-1.5 text-xs font-medium ${
                          STATUS_STYLES[booking.status]
                        }`}
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-4 whitespace-nowrap sm:px-6">
                      {new Date(booking.startsAt).toLocaleString("en-US", {
                        timeZone: viewerTimezone,
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {booking.timezone !== viewerTimezone && (
                        <span className="mt-0.5 block text-xs text-muted">
                          {new Date(booking.startsAt).toLocaleTimeString(
                            "en-US",
                            {
                              timeZone: booking.timezone,
                              hour: "numeric",
                              minute: "2-digit",
                            }
                          )}{" "}
                          their time
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4 text-muted sm:px-6">
                      {booking.calendar.name}
                    </td>

                    <td className="px-4 py-4 sm:px-6">
                      <div className="flex justify-end">
                        <button
                          onClick={(e) => {
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            setMenu((cur) =>
                              cur?.id === booking.id
                                ? null
                                : {
                                    id: booking.id,
                                    top: rect.bottom + 4,
                                    right: window.innerWidth - rect.right,
                                  }
                            );
                          }}
                          aria-label="More actions"
                          className="rounded px-2 py-1 text-lg leading-none text-muted hover:text-foreground"
                        >
                          ⋯
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            style={{ top: menu.top, right: menu.right }}
            className="fixed z-50 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
          >
            <button
              onClick={() => {
                const booking = bookings.find((b) => b.id === menu.id);
                setMenu(null);
                if (booking) onOpen(booking);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-hover"
            >
              View details
            </button>
            <button
              onClick={() => {
                const booking = bookings.find((b) => b.id === menu.id);
                setMenu(null);
                if (booking) onDelete(booking);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-error hover:bg-surface-hover"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
