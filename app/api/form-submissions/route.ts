import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

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
  const formId = searchParams.get("formId");
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    ...(formId && formId !== "all" ? { formId } : {}),
  };

  const [submissions, total] = await Promise.all([
    prisma.formSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        contact: {
          select: { id: true, name: true, email: true, phone: true },
        },
        form: { select: { id: true, name: true } },
      },
    }),
    prisma.formSubmission.count({ where }),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        submissions,
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
