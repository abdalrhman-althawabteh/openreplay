/**
 * The hidden field every public form and booking page renders.
 *
 * Its own module on purpose: the client components need this constant, and
 * importing it from `public-submit-guard` would drag BullMQ and ioredis into
 * the browser bundle along with it.
 */
export const HONEYPOT_FIELD = "website_url";
