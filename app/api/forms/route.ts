import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { publicSlug } from "@/lib/public-slug";
import { formFieldsSchema } from "@/lib/forms/fields";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const formFields = {
  name: z.string().min(1).max(100),
  headline: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  submitButtonLabel: z.string().min(1).max(40),
  successMessage: z.string().min(1).max(500),
  // Empty string means "no redirect", which is how a cleared input arrives.
  redirectUrl: z
    .union([z.string().url().max(500), z.literal("")])
    .nullable()
    .optional(),
  fields: formFieldsSchema,
  isActive: z.boolean(),
};

const createFormSchema = z.object({
  name: formFields.name,
  headline: formFields.headline,
  description: formFields.description,
  submitButtonLabel: formFields.submitButtonLabel.default("Submit"),
  successMessage: formFields.successMessage.default(
    "Thanks! We'll be in touch."
  ),
  redirectUrl: formFields.redirectUrl,
  fields: formFields.fields.default([]),
  isActive: formFields.isActive.default(true),
});

const updateFormSchema = z.object({
  name: formFields.name.optional(),
  headline: formFields.headline,
  description: formFields.description,
  submitButtonLabel: formFields.submitButtonLabel.optional(),
  successMessage: formFields.successMessage.optional(),
  redirectUrl: formFields.redirectUrl,
  fields: formFields.fields.optional(),
  isActive: formFields.isActive.optional(),
});

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const formId = request.nextUrl.searchParams.get("id");

  if (formId) {
    const form = await prisma.form.findFirst({
      where: { id: formId, workspaceId },
      include: {
        calendars: { select: { id: true, name: true, slug: true } },
        _count: { select: { submissions: true } },
      },
    });
    if (!form) {
      return NextResponse.json(
        { success: false, error: "Form not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: true, data: form },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const forms = await prisma.form.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      calendars: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
  });

  return NextResponse.json(
    { success: true, data: forms },
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
      { success: false, error: "Only owners and admins can create forms" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createFormSchema.safeParse(body ?? {});
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

  const form = await prisma.form.create({
    data: {
      workspaceId: context.workspaceId,
      slug: publicSlug(parsed.data.name),
      ...parsed.data,
      redirectUrl: parsed.data.redirectUrl || null,
    },
  });

  return NextResponse.json({ success: true, data: form }, { status: 201 });
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
      { success: false, error: "Only owners and admins can edit forms" },
      { status: 403 }
    );
  }

  const formId = request.nextUrl.searchParams.get("id");
  if (!formId) {
    return NextResponse.json(
      { success: false, error: "Missing form id" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateFormSchema.safeParse(body ?? {});
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

  const existing = await prisma.form.findFirst({
    where: { id: formId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Form not found" },
      { status: 404 }
    );
  }

  // The slug survives a rename on purpose: the form link is already embedded
  // on the owner's website, and changing it would break every copy.
  const form = await prisma.form.update({
    where: { id: formId },
    data: {
      ...parsed.data,
      ...(parsed.data.redirectUrl !== undefined
        ? { redirectUrl: parsed.data.redirectUrl || null }
        : {}),
    },
  });

  return NextResponse.json({ success: true, data: form });
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
      { success: false, error: "Only owners and admins can delete forms" },
      { status: 403 }
    );
  }

  const formId = request.nextUrl.searchParams.get("id");
  if (!formId) {
    return NextResponse.json(
      { success: false, error: "Missing form id" },
      { status: 400 }
    );
  }

  const existing = await prisma.form.findFirst({
    where: { id: formId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Form not found" },
      { status: 404 }
    );
  }

  await prisma.form.delete({ where: { id: formId } });

  return NextResponse.json({ success: true, data: { id: formId } });
}
