import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  const userAgent = request.headers.get("user-agent") ?? "";
  if (/Instagram|FBAN|FBAV/i.test(userAgent)) {
    return new Response(escapePage(trackedLink.destinationUrl, userAgent), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}

// Instagram/Facebook open links in their own logged-out webview. Hand the link to the
// phone instead: Android resolves an intent:// to the matching app (YouTube, Skool…) or
// the default browser; iOS has no generic hand-off, so YouTube gets its app scheme and
// everything else goes to Safari. The button covers devices where the auto-jump is blocked.
function externalUrl(destinationUrl: string, userAgent: string) {
  const url = new URL(destinationUrl);
  const rest = `${url.host}${url.pathname}${url.search}`;
  if (/Android/i.test(userAgent)) {
    return `intent://${rest}#Intent;scheme=${url.protocol.slice(0, -1)};S.browser_fallback_url=${encodeURIComponent(destinationUrl)};end`;
  }
  if (/youtube\.com$|youtu\.be$/i.test(url.hostname)) return `youtube://${rest}`;
  return `x-safari-${destinationUrl}`;
}

function escapePage(destinationUrl: string, userAgent: string) {
  const target = externalUrl(destinationUrl, userAgent);
  const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening…</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center;background:#fff;color:#111}a{display:block;margin:12px auto;padding:14px 20px;border-radius:10px;background:#111;color:#fff;text-decoration:none;max-width:320px}small{color:#666}</style></head>
<body><div><p>Opening the link…</p><a href="${attr(target)}">Open in app / browser</a><small>Still here? Tap ⋯ at the top and choose “Open in external browser”.</small></div>
<script>location.href=${JSON.stringify(target).replace(/</g, "\\u003c")};</script></body></html>`;
}
