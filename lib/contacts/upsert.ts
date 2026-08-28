import { prisma } from "@/lib/db/client";
import type { Contact, Prisma } from "@/app/generated/prisma/client";
import type { ContactSource } from "./sources";

/**
 * Either the shared client or a transaction handle. Callers that create a
 * contact alongside other rows pass their `tx` so a later failure rolls the
 * contact back with everything else.
 */
type ContactClient = Prisma.TransactionClient | typeof prisma;

export type ContactCapture = {
  workspaceId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  source: ContactSource;
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Find-or-create the contact behind a public capture (a form submission or a
 * booking). Email is the identity key, lowercased so `A@b.com` and `a@b.com`
 * are the same person.
 *
 * Existing values are never overwritten — a later submission only fills in
 * blanks. Otherwise a booking form that asks for less than the lead form would
 * quietly erase details the owner already has.
 *
 * Anonymous captures (no email) always create a new row; there is nothing to
 * match them on.
 */
export async function upsertContactFromCapture(
  capture: ContactCapture,
  client: ContactClient = prisma
): Promise<Contact> {
  const workspaceId = capture.workspaceId;
  const email = clean(capture.email)?.toLowerCase() ?? null;
  const incoming = {
    name: clean(capture.name),
    phone: clean(capture.phone),
    country: clean(capture.country),
  };

  if (email) {
    const existing = await client.contact.findFirst({
      where: { workspaceId, email },
    });
    if (existing) {
      return client.contact.update({
        where: { id: existing.id },
        data: {
          name: existing.name ?? incoming.name,
          phone: existing.phone ?? incoming.phone,
          country: existing.country ?? incoming.country,
        },
      });
    }
  }

  try {
    return await client.contact.create({
      data: { workspaceId, email, source: capture.source, ...incoming },
    });
  } catch (error) {
    // Two submissions from the same email landing at once: the unique index on
    // [workspaceId, email] rejects the loser. Read the winner rather than
    // failing a real visitor's submission.
    if (email && isUniqueViolation(error)) {
      const winner = await client.contact.findFirst({
        where: { workspaceId, email },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
