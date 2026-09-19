import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const folderSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const folders = await prisma.folder.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    include: { _count: { select: { automations: true } } },
  });

  return NextResponse.json(
    { success: true, data: folders },
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
      { success: false, error: "Only owners and admins can create folders" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = folderSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const folder = await prisma.folder.create({
    data: { workspaceId: context.workspaceId, name: parsed.data.name },
  });

  return NextResponse.json({ success: true, data: folder }, { status: 201 });
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
      { success: false, error: "Only owners and admins can rename folders" },
      { status: 403 }
    );
  }

  const folderId = request.nextUrl.searchParams.get("id");
  if (!folderId) {
    return NextResponse.json(
      { success: false, error: "Missing folder id" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = folderSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.folder.findFirst({
    where: { id: folderId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Folder not found" },
      { status: 404 }
    );
  }

  const folder = await prisma.folder.update({
    where: { id: folderId },
    data: { name: parsed.data.name },
  });

  return NextResponse.json({ success: true, data: folder });
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
      { success: false, error: "Only owners and admins can delete folders" },
      { status: 403 }
    );
  }

  const folderId = request.nextUrl.searchParams.get("id");
  if (!folderId) {
    return NextResponse.json(
      { success: false, error: "Missing folder id" },
      { status: 400 }
    );
  }

  const existing = await prisma.folder.findFirst({
    where: { id: folderId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Folder not found" },
      { status: 404 }
    );
  }

  // Automations inside are unfiled, not deleted (folderId is ON DELETE SET NULL).
  await prisma.folder.delete({ where: { id: folderId } });

  return NextResponse.json({ success: true, data: { id: folderId } });
}
