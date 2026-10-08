import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    trackedLink: {
      findUnique: vi.fn(),
    },
    linkClick: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { GET } from "../app/r/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tracked link redirect route", () => {
  it("logs a workspace-isolated click and redirects to the destination", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: {
        instagramAccountId: "instagram_account_123",
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/abc123", {
        headers: {
          "user-agent": "vitest",
          referer: "https://instagram.com/",
          "x-forwarded-for": "203.0.113.10",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offer");
    expect(mockPrisma.trackedLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc123" },
      select: expect.any(Object),
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_123",
        automationId: "automation_123",
        instagramAccountId: "instagram_account_123",
        trackedLinkId: "link_123",
        userAgent: "vitest",
        referrer: "https://instagram.com/",
      }),
    });
  });

  it("redirects unknown slugs to the homepage without logging a click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);

    const response = await GET(
      new Request("https://manychat-alternative.com/r/missing") as Parameters<
        typeof GET
      >[0],
      { params: Promise.resolve({ slug: "missing" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://manychat-alternative.com/");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
  });
});

describe("in-app browser escape", () => {
  async function open(destinationUrl: string, userAgent: string) {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "l", workspaceId: "w", automationId: "a", destinationUrl,
      automation: { instagramAccountId: "i" },
    });
    const response = await GET(
      new Request("https://x.com/r/s", { headers: { "user-agent": userAgent } }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "s" }) }
    );
    expect(response.status).toBe(200);
    expect(mockPrisma.linkClick.create).toHaveBeenCalled();
    return response.text();
  }
  const android = "Mozilla/5.0 (Linux; Android 14) Instagram 300.0";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Instagram 300.0";

  it("hands Android an intent so the matching app or browser opens", async () => {
    expect(await open("https://www.skool.com/abc", android)).toContain(
      "intent://www.skool.com/abc#Intent;scheme=https;S.browser_fallback_url=https%3A%2F%2Fwww.skool.com%2Fabc;end"
    );
  });

  it("gives iPhone a plain link to tap, so iOS can hand it to the app", async () => {
    const page = await open("https://www.youtube.com/watch?v=X&t=1", iphone);
    expect(page).toContain('href="https://www.youtube.com/watch?v=X&amp;t=1"');
    expect(page).toContain("Open on youtube.com");
    expect(page).not.toContain("<script>");
  });
});
