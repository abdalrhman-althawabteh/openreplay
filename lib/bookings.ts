/**
 * The booking shape the dashboard works with, plus the labels and colours the
 * three views share. Kept in one place so the table, the month grid and the
 * details panel can never drift apart.
 */

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export type Booking = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: BookingStatus;
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
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export const STATUS_STYLES: Record<BookingStatus, string> = {
  PENDING: "border-warning/30 bg-warning/10 text-warning",
  CONFIRMED: "border-success/30 bg-success/10 text-success",
  CANCELLED: "border-border bg-surface text-muted",
};

/** Who the appointment is with, however little we know about them. */
export function bookingTitle(booking: Booking) {
  return booking.contact.name ?? booking.contact.email ?? "Someone";
}
