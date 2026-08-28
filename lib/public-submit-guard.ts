/**
 * Abuse controls for the two unauthenticated write endpoints — public form
 * submissions and public bookings.
 *
 * Everything else in this app is behind a session. These two are not, so they
 * get an explicit throttle rather than relying on the endpoints to be obscure.
 */

import { HONEYPOT_FIELD } from "@/lib/honeypot";
import { getRedisConnection } from "@/lib/queue/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

/** Writes allowed per IP per window. Generous for a person, useless for a bot. */
const MAX_PER_WINDOW = 20;
const WINDOW_SECONDS = 3600;

export function isHoneypotFilled(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The visitor's country, as reported by whichever CDN is in front of us.
 * Null in local development — no header, no guess.
 */
export function getRequestCountry(request: Request): string | null {
  const country =
    request.headers.get("x-vercel-ip-country") ??
    request.headers.get("cf-ipcountry");
  return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

/**
 * Returns false when this IP has spent its budget.
 *
 * ponytail: a fixed window via INCR + EXPIRE, not a sliding log. A visitor can
 * burst at a window boundary; that costs nothing worth a sorted set here.
 *
 * Redis being unreachable must not take the public pages down with it, so a
 * connection failure fails open and is logged.
 */
export async function allowPublicSubmit(
  request: Request,
  scope: string
): Promise<boolean> {
  const ipHash = hashClickIp(getRequestIp(request));
  if (!ipHash) return true;

  try {
    const redis = getRedisConnection();
    const key = `public-submit:${scope}:${ipHash}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS);
    return count <= MAX_PER_WINDOW;
  } catch (error) {
    console.error("[public-submit] rate limit unavailable:", error);
    return true;
  }
}
