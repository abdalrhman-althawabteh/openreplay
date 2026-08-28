/**
 * Where a contact came from.
 *
 * A plain string column rather than a Prisma enum, so a new capture surface
 * never needs a migration to add itself.
 */
export const CONTACT_SOURCES = [
  "MANUAL",
  "FORM",
  "BOOKING",
  "INSTAGRAM",
] as const;

export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Added manually",
  FORM: "Form",
  BOOKING: "Booking",
  INSTAGRAM: "Instagram",
};

export function contactSourceLabel(source: string) {
  return CONTACT_SOURCE_LABELS[source] ?? source;
}
