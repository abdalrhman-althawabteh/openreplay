import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { upsertContactFromCapture } from "@/lib/contacts/upsert";
import {
  contactFromAnswers,
  labelAnswers,
  parseFields,
  validateAnswers,
} from "@/lib/forms/fields";
import {
  addDays,
  availabilitySchema,
  dateStringSchema,
  generateSlots,
  isBookableSlot,
  todayInZone,
  type Availability,
  type SlotCalendar,
} from "@/lib/calendars/slots";
import {
  allowPublicSubmit,
  getRequestCountry,
  isHoneypotFilled,
} from "@/lib/public-submit-guard";

// Slot availability changes the moment anyone books, so it must never be
// cached anywhere between the database and the visitor.
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ slug: string }> };

/**
 * How far ahead one slots request may look, whatever range it asks for.
 *
 * A month grid is six weeks — 42 days including the padding from the
 * neighbouring months — so anything smaller silently truncates the calendar
 * the visitor is looking at.
 */
const MAX_RANGE_DAYS = 42;

// When a form is attached it supplies the contact details, so name and email
// are only required in the plain no-form case. Which of the two applies is
// decided against the calendar, below — never against what the browser claims.
const bookSchema = z.object({
  startsAt: z.string().datetime(),
  timezone: z.string().min(1).max(64),
  name: z.string().max(120).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // The attached form's answers, keyed by field id.
  answers: z.record(z.string(), z.unknown()).optional(),
});

async function loadCalendar(slug: string) {
  return prisma.calendar.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      description: true,
      timezone: true,
      durationMinutes: true,
      bufferMinutes: true,
      minNoticeHours: true,
      maxDaysAhead: true,
      availability: true,
      formFirst: true,
      successMessage: true,
      redirectUrl: true,
      form: {
        select: {
          id: true,
          headline: true,
          description: true,
          submitButtonLabel: true,
          fields: true,
        },
      },
    },
  });
}

/**
 * The availability JSON is validated on the way in, but a row written by an
 * older version could still be malformed. Treat an unreadable calendar as
 * simply having no open hours rather than crashing the public page.
 */
function toSlotCalendar(calendar: {
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  availability: unknown;
}): SlotCalendar {
  const parsed = availabilitySchema.safeParse(calendar.availability);
  return {
    timezone: calendar.timezone,
    durationMinutes: calendar.durationMinutes,
    bufferMinutes: calendar.bufferMinutes,
    minNoticeHours: calendar.minNoticeHours,
    maxDaysAhead: calendar.maxDaysAhead,
    availability: (parsed.success ? parsed.data : {}) as Availability,
  };
}

function busyFilter(calendarId: string) {
  return {
    calendarId,
    // A cancelled booking frees its slot again.
    status: { not: "CANCELLED" as const },
  };
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { slug } = await params;
  const calendar = await loadCalendar(slug);
  if (!calendar) {
    return NextResponse.json(
      { success: false, error: "Calendar not found" },
      { status: 404 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const defaultFrom = todayInZone(calendar.timezone);
  const from = dateStringSchema.safeParse(searchParams.get("from"));
  const to = dateStringSchema.safeParse(searchParams.get("to"));

  const fromISO = from.success ? from.data : defaultFrom;
  const requestedTo = to.success ? to.data : addDays(fromISO, 6);
  const maxTo = addDays(fromISO, MAX_RANGE_DAYS);
  const toISO = requestedTo > maxTo ? maxTo : requestedTo;

  const busy = await prisma.booking.findMany({
    where: {
      ...busyFilter(calendar.id),
      // Only bookings that could overlap the window matter.
      endsAt: { gte: new Date(`${fromISO}T00:00:00.000Z`) },
      startsAt: { lte: new Date(`${addDays(toISO, 1)}T00:00:00.000Z`) },
    },
    select: { startsAt: true, endsAt: true },
  });

  const slots = generateSlots({
    calendar: toSlotCalendar(calendar),
    fromISO,
    toISO,
    busy,
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        calendar: {
          name: calendar.name,
          description: calendar.description,
          timezone: calendar.timezone,
          durationMinutes: calendar.durationMinutes,
          formFirst: calendar.formFirst,
          successMessage: calendar.successMessage,
        },
        form: calendar.form
          ? {
              headline: calendar.form.headline,
              description: calendar.form.description,
              submitButtonLabel: calendar.form.submitButtonLabel,
              fields: parseFields(calendar.form.fields),
            }
          : null,
        range: { from: fromISO, to: toISO },
        slots: slots.map((slot) => slot.toISOString()),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { slug } = await params;

  const body = await request.json().catch(() => null);

  // Answer a bot exactly as we answer a person, so it learns nothing.
  if (isHoneypotFilled(body)) {
    return NextResponse.json({ success: true, data: { booked: true } });
  }

  if (!(await allowPublicSubmit(request, "booking"))) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  const calendar = await loadCalendar(slug);
  if (!calendar) {
    return NextResponse.json(
      { success: false, error: "Calendar not found" },
      { status: 404 }
    );
  }

  const parsed = bookSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const startsAt = new Date(parsed.data.startsAt);
  const slotCalendar = toSlotCalendar(calendar);
  const country = getRequestCountry(request);

  // Whether a form applies is decided here, from the calendar, not from what
  // the browser sent. The form's own questions are the schema for `answers`:
  // unknown ids are rejected, required answers enforced, choices checked.
  const fields = calendar.form ? parseFields(calendar.form.fields) : [];
  let answers: ReturnType<typeof labelAnswers> | null = null;
  let details: { name?: string; email?: string; phone?: string };

  if (calendar.form) {
    const validated = validateAnswers(fields, parsed.data.answers ?? {});
    if (!validated.ok) {
      return NextResponse.json(
        { success: false, error: validated.error },
        { status: 400 }
      );
    }
    details = contactFromAnswers(fields, validated.answers);
    answers = labelAnswers(fields, validated.answers);

    // capturesEmail() gates this when the form is attached, so a form without
    // an email question cannot reach here — but a form edited afterwards could.
    if (!details.email) {
      return NextResponse.json(
        { success: false, error: "This booking form is missing an email question." },
        { status: 400 }
      );
    }
  } else {
    // No form attached: the widget asked for these three directly.
    if (!parsed.data.name || !parsed.data.email) {
      return NextResponse.json(
        { success: false, error: "Name and email are required" },
        { status: 400 }
      );
    }
    details = {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? undefined,
    };
  }

  const booking = await prisma.$transaction(async (tx) => {
    // ponytail: the conflict check and the insert share one transaction rather
    // than a unique index, because a cancelled booking has to free its slot
    // again. Add a partial unique index (WHERE status <> 'CANCELLED') if a real
    // double-booking ever lands.
    const busy = await tx.booking.findMany({
      where: busyFilter(calendar.id),
      select: { startsAt: true, endsAt: true },
    });

    // Never trust the time the browser sent: re-derive whether it is genuinely
    // open, which also rejects a slot taken while this visitor was choosing.
    if (!isBookableSlot({ calendar: slotCalendar, startsAt, busy })) {
      return null;
    }

    const contact = await upsertContactFromCapture(
      {
        workspaceId: calendar.workspaceId,
        name: details.name,
        email: details.email,
        phone: details.phone,
        country,
        source: "BOOKING",
      },
      tx
    );

    // Both steps land together. Someone who fills the form and never picks a
    // time leaves nothing behind — no orphan submission, no half-made contact.
    if (calendar.form && answers) {
      await tx.formSubmission.create({
        data: {
          workspaceId: calendar.workspaceId,
          formId: calendar.form.id,
          contactId: contact.id,
          answers,
          country,
        },
      });
    }

    return tx.booking.create({
      data: {
        workspaceId: calendar.workspaceId,
        calendarId: calendar.id,
        contactId: contact.id,
        startsAt,
        endsAt: new Date(
          startsAt.getTime() + calendar.durationMinutes * 60_000
        ),
        timezone: parsed.data.timezone,
        notes: parsed.data.notes ?? null,
        answers: answers ?? undefined,
      },
    });
  });

  if (!booking) {
    return NextResponse.json(
      {
        success: false,
        error: "That time was just taken. Pick another slot.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        booked: true,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
