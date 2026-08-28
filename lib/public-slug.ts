import { randomBytes } from "node:crypto";

/**
 * A readable, unguessable slug for a publicly shared page.
 *
 * The name half is cosmetic — it makes `/book/sales-call-hK3xQ9` recognisable
 * in a browser's history. The random half is what makes the URL unguessable
 * and keeps two calendars called "Sales call" from colliding.
 */
export function publicSlug(name: string): string {
  const readable = name
    .toLowerCase()
    .normalize("NFKD")
    // Anything that isn't an ASCII letter or digit becomes a separator, so an
    // Arabic or emoji name degrades to just the random half rather than
    // producing a URL that needs percent-encoding.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  const suffix = randomBytes(6).toString("base64url");
  return readable ? `${readable}-${suffix}` : suffix;
}
