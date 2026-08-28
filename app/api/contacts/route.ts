import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { CONTACT_SOURCES } from "@/lib/contacts/sources";

// Read-your-writes: a contact edited or deleted here must show up on the next
// load, so never cache this at the route or CDN layer.
export const dynamic = "force-dynamic";

const contactFields = {
  name: z.string().max(120).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
};

const createContactSchema = z
  .object(contactFields)
  // A contact with neither a name nor a way to reach them is just a blank row.
  .refine((value) => value.name || value.email || value.phone, {
    message: "Give the contact at least a name, an email, or a phone number",
  });

const updateContactSchema = z.object(contactFields);

/** Empty strings from a form field mean "clear it", not "set it to ''". */
function blankToNull<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(output)) {
    if (value === "") output[key] = null;
  }
  return output as T;
}

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
  const search = (searchParams.get("search") ?? "").trim();
  const sourceParam = searchParams.get("source");
  const source =
    sourceParam && (CONTACT_SOURCES as readonly string[]).includes(sourceParam)
      ? sourceParam
      : null;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        _count: { select: { bookings: true, submissions: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        contacts,
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
      { success: false, error: "Only owners and admins can create contacts" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createContactSchema.safeParse(blankToNull(body ?? {}));
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

  const existing = parsed.data.email
    ? await prisma.contact.findFirst({
        where: { workspaceId: context.workspaceId, email: parsed.data.email },
        select: { id: true },
      })
    : null;
  if (existing) {
    return NextResponse.json(
      { success: false, error: "A contact with that email already exists" },
      { status: 409 }
    );
  }

  const contact = await prisma.contact.create({
    data: {
      workspaceId: context.workspaceId,
      ...parsed.data,
      source: parsed.data.source ?? "MANUAL",
    },
  });

  return NextResponse.json({ success: true, data: contact }, { status: 201 });
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
      { success: false, error: "Only owners and admins can edit contacts" },
      { status: 403 }
    );
  }

  const contactId = request.nextUrl.searchParams.get("id");
  if (!contactId) {
    return NextResponse.json(
      { success: false, error: "Missing contact id" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateContactSchema.safeParse(blankToNull(body ?? {}));
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

  const existing = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Contact not found" },
      { status: 404 }
    );
  }

  if (parsed.data.email) {
    const clash = await prisma.contact.findFirst({
      where: {
        workspaceId: context.workspaceId,
        email: parsed.data.email,
        id: { not: contactId },
      },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { success: false, error: "Another contact already uses that email" },
        { status: 409 }
      );
    }
  }

  const contact = await prisma.contact.update({
    where: { id: contactId },
    data: parsed.data,
  });

  return NextResponse.json({ success: true, data: contact });
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
      { success: false, error: "Only owners and admins can delete contacts" },
      { status: 403 }
    );
  }

  const contactId = request.nextUrl.searchParams.get("id");
  if (!contactId) {
    return NextResponse.json(
      { success: false, error: "Missing contact id" },
      { status: 400 }
    );
  }

  const existing = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Contact not found" },
      { status: 404 }
    );
  }

  // Bookings cascade with the contact — deleting a person deletes their
  // appointments, which is what "delete this contact" has to mean.
  await prisma.contact.delete({ where: { id: contactId } });

  return NextResponse.json({ success: true, data: { id: contactId } });
}
