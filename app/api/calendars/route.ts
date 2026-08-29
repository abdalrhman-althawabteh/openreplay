import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { publicSlug } from "@/lib/public-slug";
import { availabilitySchema } from "@/lib/calendars/slots";
import { capturesEmail, parseFields } from "@/lib/forms/fields";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

/**
 * Reject a zone the runtime does not know, so a typo can't create a calendar
 * whose slots are silently generated in the wrong place.
 */
const timezoneSchema = z.string().min(1).max(64).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Unknown time zone" }
);

const calendarFields = {
  name: z.string().min(1).max(100),
  description: z.string().max(1000).nullable().optional(),
  timezone: timezoneSchema,
  durationMinutes: z.number().int().min(5).max(480),
  bufferMinutes: z.number().int().min(0).max(240),
  minNoticeHours: z.number().int().min(0).max(720),
  maxDaysAhead: z.number().int().min(1).max(365),
  availability: availabilitySchema,
  isActive: z.boolean(),
  // Empty string means "no form", which is how a cleared <select> arrives.
  formId: z.union([z.string().min(1), z.literal("")]).nullable().optional(),
  formFirst: z.boolean(),
  successMessage: z.string().min(1).max(500),
  redirectUrl: z
    .union([z.string().url().max(500), z.literal("")])
    .nullable()
    .optional(),
};

const createCalendarSchema = z.object({
  name: calendarFields.name,
  description: calendarFields.description,
  timezone: calendarFields.timezone.default("UTC"),
  durationMinutes: calendarFields.durationMinutes.default(30),
  bufferMinutes: calendarFields.bufferMinutes.default(0),
  minNoticeHours: calendarFields.minNoticeHours.default(12),
  maxDaysAhead: calendarFields.maxDaysAhead.default(30),
  availability: calendarFields.availability.default({}),
  isActive: calendarFields.isActive.default(true),
  formId: calendarFields.formId,
  formFirst: calendarFields.formFirst.default(true),
  successMessage: calendarFields.successMessage.default(
    "Thanks! We'll review your request and get back to you."
  ),
  redirectUrl: calendarFields.redirectUrl,
});

const updateCalendarSchema = z.object({
  name: calendarFields.name.optional(),
  description: calendarFields.description,
  timezone: calendarFields.timezone.optional(),
  durationMinutes: calendarFields.durationMinutes.optional(),
  bufferMinutes: calendarFields.bufferMinutes.optional(),
  minNoticeHours: calendarFields.minNoticeHours.optional(),
  maxDaysAhead: calendarFields.maxDaysAhead.optional(),
  availability: calendarFields.availability.optional(),
  isActive: calendarFields.isActive.optional(),
  formId: calendarFields.formId,
  formFirst: calendarFields.formFirst.optional(),
  successMessage: calendarFields.successMessage.optional(),
  redirectUrl: calendarFields.redirectUrl,
});

/**
 * Resolve the form a calendar should use.
 *
 * Returns the id to store, `undefined` to leave it alone, or an error string
 * when the form is not ours or cannot identify the person booking.
 */
async function resolveFormId(
  workspaceId: string,
  formId: string | null | undefined
): Promise<{ value?: string | null; error?: string }> {
  if (formId === undefined) return {};
  if (formId === null || formId === "") return { value: null };

  const form = await prisma.form.findFirst({
    where: { id: formId, workspaceId },
    select: { fields: true },
  });
  if (!form) return { error: "Form not found" };

  // Without an email there is no key to dedupe the contact on, so every
  // booking would quietly create a new person.
  if (!capturesEmail(parseFields(form.fields))) {
    return {
      error:
        "That form has no email question, so bookings could not be matched to a contact. Add an email field to it first.",
    };
  }

  return { value: formId };
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const calendarId = request.nextUrl.searchParams.get("id");

  if (calendarId) {
    const calendar = await prisma.calendar.findFirst({
      where: { id: calendarId, workspaceId },
      include: {
        form: { select: { id: true, name: true, slug: true } },
        _count: { select: { bookings: true } },
      },
    });
    if (!calendar) {
      return NextResponse.json(
        { success: false, error: "Calendar not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: true, data: calendar },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const calendars = await prisma.calendar.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      form: { select: { id: true, name: true } },
      _count: { select: { bookings: true } },
    },
  });

  // One extra query rather than one per calendar: how many bookings are still
  // waiting for a decision, which is the number the list actually shows.
  const pendingCounts = await prisma.booking.groupBy({
    by: ["calendarId"],
    where: { workspaceId, status: "PENDING" },
    _count: { _all: true },
  });
  const pendingByCalendar = new Map(
    pendingCounts.map((row) => [row.calendarId, row._count._all])
  );

  return NextResponse.json(
    {
      success: true,
      data: calendars.map((calendar) => ({
        ...calendar,
        pendingBookings: pendingByCalendar.get(calendar.id) ?? 0,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can create calendars" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createCalendarSchema.safeParse(body ?? {});
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

  const form = await resolveFormId(context.workspaceId, parsed.data.formId);
  if (form.error) {
    return NextResponse.json(
      { success: false, error: form.error },
      { status: 400 }
    );
  }

  const calendar = await prisma.calendar.create({
    data: {
      workspaceId: context.workspaceId,
      slug: publicSlug(parsed.data.name),
      ...parsed.data,
      formId: form.value ?? null,
      redirectUrl: parsed.data.redirectUrl || null,
    },
  });

  return NextResponse.json({ success: true, data: calendar }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can edit calendars" },
      { status: 403 }
    );
  }

  const calendarId = request.nextUrl.searchParams.get("id");
  if (!calendarId) {
    return NextResponse.json(
      { success: false, error: "Missing calendar id" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateCalendarSchema.safeParse(body ?? {});
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

  const existing = await prisma.calendar.findFirst({
    where: { id: calendarId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Calendar not found" },
      { status: 404 }
    );
  }

  const form = await resolveFormId(context.workspaceId, parsed.data.formId);
  if (form.error) {
    return NextResponse.json(
      { success: false, error: form.error },
      { status: 400 }
    );
  }

  // The slug is deliberately never regenerated on rename: the booking link is
  // already out in the world, and changing it would break every copy of it.
  const calendar = await prisma.calendar.update({
    where: { id: calendarId },
    data: {
      ...parsed.data,
      ...(parsed.data.formId !== undefined ? { formId: form.value } : {}),
      ...(parsed.data.redirectUrl !== undefined
        ? { redirectUrl: parsed.data.redirectUrl || null }
        : {}),
    },
  });

  return NextResponse.json({ success: true, data: calendar });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can delete calendars" },
      { status: 403 }
    );
  }

  const calendarId = request.nextUrl.searchParams.get("id");
  if (!calendarId) {
    return NextResponse.json(
      { success: false, error: "Missing calendar id" },
      { status: 400 }
    );
  }

  const existing = await prisma.calendar.findFirst({
    where: { id: calendarId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Calendar not found" },
      { status: 404 }
    );
  }

  await prisma.calendar.delete({ where: { id: calendarId } });

  return NextResponse.json({ success: true, data: { id: calendarId } });
}
