import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getUserStories } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

// Stories live for 24 hours and change constantly, so this is always fetched
// fresh — a cached list would offer stories that have already expired.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );

  if (!account) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Instagram account not connected. Please connect your account first.",
      },
      { status: 400 }
    );
  }

  try {
    const stories = await getUserStories(decryptToken(account.accessToken));
    return NextResponse.json({ success: true, data: stories });
  } catch (err) {
    console.error("[Instagram Stories] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch Instagram stories" },
      { status: 500 }
    );
  }
}
