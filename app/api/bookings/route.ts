import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { BookingStatus } from "@/app/generated/prisma/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const updateBookingSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "25", 10))
  );
  const calendarId = searchParams.get("calendarId");
  const statusParam = searchParams.get("status");
  const status =
    statusParam && statusParam in BookingStatus
      ? (statusParam as BookingStatus)
      : null;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    ...(calendarId && calendarId !== "all" ? { calendarId } : {}),
    ...(status ? { status } : {}),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      // Soonest first: the appointments that need a decision are the ones
      // happening next, not the ones booked most recently.
      orderBy: { startsAt: "asc" },
      skip,
      take: limit,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            country: true,
          },
        },
        calendar: { select: { id: true, name: true, timezone: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        bookings,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
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
      { success: false, error: "Only owners and admins can change bookings" },
      { status: 403 }
    );
  }

  const bookingId = request.nextUrl.searchParams.get("id");
  if (!bookingId) {
    return NextResponse.json(
      { success: false, error: "Missing booking id" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateBookingSchema.safeParse(body ?? {});
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

  const existing = await prisma.booking.findFirst({
    where: { id: bookingId, workspaceId: context.workspaceId },
    select: {
      id: true,
      calendarId: true,
      startsAt: true,
      endsAt: true,
      status: true,
    },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Booking not found" },
      { status: 404 }
    );
  }

  // Cancelling frees a slot, so someone else may have taken it in the meantime.
  // Bringing this booking back has to check that, or reopening would silently
  // double-book the calendar.
  const isReviving =
    existing.status === "CANCELLED" &&
    parsed.data.status !== undefined &&
    parsed.data.status !== "CANCELLED";

  if (isReviving) {
    const clash = await prisma.booking.findFirst({
      where: {
        calendarId: existing.calendarId,
        id: { not: existing.id },
        status: { not: "CANCELLED" },
        startsAt: { lt: existing.endsAt },
        endsAt: { gt: existing.startsAt },
      },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        {
          success: false,
          error: "Someone else has taken that time. Cancel theirs first.",
        },
        { status: 409 }
      );
    }
  }

  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      ...parsed.data,
      // Cancelling stamps the time; un-cancelling clears it, so the column
      // never disagrees with the status.
      ...(parsed.data.status
        ? {
            cancelledAt:
              parsed.data.status === "CANCELLED" ? new Date() : null,
          }
        : {}),
    },
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          country: true,
        },
      },
      calendar: { select: { id: true, name: true, timezone: true } },
    },
  });

  return NextResponse.json({ success: true, data: booking });
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
      { success: false, error: "Only owners and admins can delete bookings" },
      { status: 403 }
    );
  }

  const bookingId = request.nextUrl.searchParams.get("id");
  if (!bookingId) {
    return NextResponse.json(
      { success: false, error: "Missing booking id" },
      { status: 400 }
    );
  }

  const existing = await prisma.booking.findFirst({
    where: { id: bookingId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Booking not found" },
      { status: 404 }
    );
  }

  await prisma.booking.delete({ where: { id: bookingId } });

  return NextResponse.json({ success: true, data: { id: bookingId } });
}
