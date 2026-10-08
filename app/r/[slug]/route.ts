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

// Instagram/Facebook open links in their own logged-out webview. A redirect never leaves it,
// but a real tap on a plain https link does: iOS hands youtube.com, skool.com… to their app
// (universal links), the way link-in-bio pages work. So the page's button is the plain URL.
// Android also gets an intent:// auto-jump to the matching app or default browser.
function escapePage(destinationUrl: string, userAgent: string) {
  const url = new URL(destinationUrl);
  const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const intent = /Android/i.test(userAgent)
    ? `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};S.browser_fallback_url=${encodeURIComponent(destinationUrl)};end`
    : null;
  const host = url.hostname.replace(/^www\./, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${attr(host)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center;background:#fff;color:#111}a{display:block;margin:12px auto;padding:16px 20px;border-radius:12px;background:#111;color:#fff;text-decoration:none;font-weight:600;max-width:320px}small{color:#666}</style></head>
<body><div><a href="${attr(destinationUrl)}">Open on ${attr(host)}</a><small>Opens in the app if you have it. Website staying in Instagram? Tap ⋯ at the top → “Open in external browser”.</small></div>
${intent ? `<script>location.href=${JSON.stringify(intent).replace(/</g, "\\u003c")};</script>` : ""}</body></html>`;
}
