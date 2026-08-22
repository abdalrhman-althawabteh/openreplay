# cloud.md — OpenReply: what it does, what it can't, and what we change before we start

Audit date: 2026-08-22. Repo: `diwenne/openreply` @ `main`. All claims below were checked
against the code in this clone, not against the README.

---

## 1. Short answer on Instagram Stories

**Story automation is possible, but this repo does not do it today.** Neither the word
"story" nor "mention" appears anywhere in the source (only "history", from the follower
chart). No dedicated code path exists.

The good news: Meta delivers **both** story interactions through the `messages` webhook,
which this repo already subscribes to and already parses. So this is a small patch, not a
new subsystem.

| Story trigger | How Meta delivers it | Status in this repo |
|---|---|---|
| **Story reply** — someone replies to *your* story in DM | `messages` webhook, normal message with `text` **plus** `message.reply_to.story.{id,url}` | **Already fires today, accidentally.** The parser keeps it because it has text, and any campaign with `dmTriggerEnabled` will keyword-match it. It just can't tell a story reply from a normal DM. |
| **Story mention** — someone tags `@you` in *their* story | `messages` webhook, **no text**, `message.attachments[0].type == "story_mention"` | **Silently dropped.** `lib/meta/webhook.ts:208` requires non-empty text, so the event never reaches the queue. |
| **Story insights** (views, exits, etc.) | `story_insights` webhook field | **Not available at all** on Instagram Login apps — Facebook Login only. Out of scope. |

So: story replies work by accident and need to be made deliberate; story mentions need
about 40 lines across 4 files.

### What is flat-out impossible on Instagram (do not promise these)

These are Meta platform limits, not repo gaps. No open-source project can do them via the
official API, and doing them by scraping or browser automation is what gets accounts banned.

- **DM everyone who viewed your story.** There is no story-viewer API. ManyChat can't do
  this either.
- **React to poll / quiz / slider sticker taps.** No webhook for sticker interactions.
- **Auto-reply to story likes.** No webhook.
- **Comment on stories.** Stories have no comments, so the whole comment-to-DM engine
  does not apply to them.
- **DM a cold user.** You can only message someone inside a 24-hour window opened by
  *their* action (comment, DM, story reply, story mention).

---

## 2. What this repo can automate right now

Verified in `lib/queue/dm-worker.ts`, `prisma/schema.prisma:168-215`, `lib/meta/client.ts`.

**Triggers (2):**
1. **Comment on a post/reel** → keyword match. Per-post or `matchAnyPost`. Whole-word or
   partial. `matchAnyWord` catches everything.
2. **Inbound DM** → keyword match (`dmTriggerEnabled`). Story replies land here too.

**Actions, per campaign:**
- Private reply DM (Meta's official comment→DM).
- Public comment reply, with a rotating pool (`publicReplyMessages[]`) so replies aren't identical.
- Opening DM with a tappable button, then a "reveal" DM on tap. Existing to dodge Meta's
  private-reply link restrictions.
- 5-minute fallback: if they read the opening DM and never tap, send the reveal anyway
  (`app/api/webhook/route.ts`, `OPENING_DM_READ_FALLBACK_DELAY_MS`).
- **Follow gate** — checks Meta's `is_user_follow_business`, re-prompts until they follow.
  Fails open when Instagram doesn't return the flag.
- Up to **2 tracked link buttons** per DM, each with its own click/CTR stats (`/r/[slug]`).
- **Delayed follow-up DM** N minutes after delivery.
- `{username}` personalisation.

**Infrastructure that's already solid:**
- Per-account rate limiter at Meta's 750 private replies/hour, with overflow queued not dropped.
- BullMQ + Redis worker, retries, idempotent job IDs.
- Polling reconciler (`lib/polling/comment-reconciler.ts`) as a safety net for dropped webhooks.
- Encrypted tokens at rest (AES-256-GCM), auto token refresh cron.
- Multi-workspace + roles (owner/admin/member) — usable as an agency.
- Inbox: read and reply to real DM threads from the dashboard.
- Follower snapshots, since Instagram only retains ~30 days of insights.
- 14 test files under `__tests__/`, CI on GitHub Actions.

**Honest assessment:** this is well-built for one feature (comment→DM) and thin on
everything else. Compared to ManyChat it is missing: multi-step conversation flows,
audience segmentation/tags, broadcasts, and any non-Instagram channel.

---

## 3. Other platforms worth adding, ranked by effort

The architecture (webhook route → BullMQ queue → worker → provider client) is
channel-agnostic. The Instagram assumption is baked into `InstagramAccount` and
`lib/meta/client.ts`, not into the queue.

| Platform | Feasible? | Effort | Notes |
|---|---|---|---|
| **Facebook Pages / Messenger** | Yes | **Low** | Same Meta app, same Graph API, same `messaging` webhook shape. Comment→DM on FB posts is the identical feature. Needs Facebook Login instead of Instagram Login, and the `feed` webhook field. **Best first expansion.** |
| **WhatsApp Business Cloud API** | Yes | Medium | Same Meta developer app. Real broadcast capability (template messages) — the one thing Instagram genuinely can't do. Needs a phone number and template approval. High commercial value. |
| **Telegram** | Yes | **Very low** | Bot API is free, no approval, no rate-limit theatre. Weekend job. Different audience though. |
| **Threads** | Partial | Medium | Meta's Threads API supports reading/posting replies. **No DM API**, so "reply publicly to a keyword" only. |
| **YouTube** | Partial | Medium | Comments API works for auto-reply. **No DM API** — YouTube killed private messaging. Comment-reply-only. |
| **Discord** | Yes | Low | Trivial API, but it's a different product category. |
| **X / Twitter** | Technically | High | DM API exists but sits behind expensive paid tiers. Poor ROI. |
| **TikTok** | **No** | — | No official comment or DM automation API. Anyone selling this is scraping. Don't. |
| **LinkedIn** | **No** | — | Messaging API is partner-only, effectively closed. |

**Recommendation:** Facebook Pages first (largest reuse, ~2 days), then WhatsApp (the real
differentiator). Skip TikTok entirely, however much clients ask for it.

---

## 4. Changes to make before we start — the actual work list

### Phase 0 — Get it running as-is (do this before writing any code)

Nothing here is optional; the Meta side is where the time goes, not the code.

1. `git clone`, `npm install`, `cp .env.example .env`.
2. `docker-compose up -d` (Postgres + Redis), then `npm run db:migrate`.
3. Two processes, always: `npm run dev` **and** `npm run worker`. If DMs never arrive,
   the worker is the first thing to check.
4. Fill `.env`: generate `NEXTAUTH_SECRET`, `CRON_SECRET`, and a 64-hex-char
   `ENCRYPTION_KEY` (`openssl rand -hex 32`). Get a Resend key for magic-link login.
5. Meta app: Instagram account must be **Business or Creator**, not personal. Follow
   `docs/setup.md` steps 4–9 exactly — especially adding your own IG account as a
   *tester* and accepting the invite, which is where most people stall.
6. Webhook needs a public HTTPS URL. Locally use a tunnel; in production, Vercel.
7. **Verify before building anything:** comment a keyword on your own reel from a second
   account, confirm the DM arrives. Then reply to your own story from that account and
   confirm a `dmTriggerEnabled` campaign fires. That single test proves the story path
   already half-works.

### Phase 1 — Story mention support (the real gap)

Four files. Estimate: half a day including a test.

1. **`lib/meta/webhook.ts:203-208`** — the drop point. Add `reply_to` to the message type,
   and stop discarding attachment-only messages when the attachment is a story mention:
   ```ts
   const isStoryMention = message.attachments?.[0]?.type === "story_mention";
   const isStoryReply = Boolean(message.reply_to?.story);
   if ((!text && !isStoryMention) || !messageId || !senderId || !accountId) continue;
   ```
   Carry `isStoryMention` / `isStoryReply` on `WebhookMessageEvent`.

2. **`prisma/schema.prisma:184`** — one new column beside `dmTriggerEnabled`:
   `storyMentionTriggerEnabled Boolean @default(false)`. A story mention has no text, so
   it cannot be keyword-gated; it needs its own opt-in flag or every DM campaign would
   fire on every mention. Then `npx prisma migrate dev`.

3. **`lib/queue/dm-worker.ts:938`** (`processMessage`) — branch on the flag: when
   `isStoryMention`, select campaigns by `storyMentionTriggerEnabled` and skip keyword
   matching entirely. Text-bearing messages keep the existing path unchanged.

4. **`components/campaign-builder.tsx`** — one checkbox: "Reply when someone mentions me
   in their story."

5. **Test** — extend `__tests__/webhook.test.ts` with the two real payload shapes:
   `{message:{mid,attachments:[{type:"story_mention"}]}}` and
   `{message:{mid,text:"LINK",reply_to:{story:{id,url}}}}`.

**Constraint to respect:** Meta forbids storing or caching the story media. Keep the CDN
URL only, never download the image.

### Phase 2 — Make story replies deliberate

Right now a story reply is indistinguishable from a normal DM. Once `isStoryReply` is
parsed (Phase 1, step 1), add an optional per-campaign filter so a campaign can target
story replies *only*. Small, but it's the difference between "it happens to work" and "it's
a feature we can sell".

### Phase 3 — Things I'd fix regardless

- `subscribed_fields` at **`lib/meta/client.ts:760`** is `["comments", "messages"]`. Add
  `"messaging_postbacks"` and `"messaging_seen"` explicitly — the postback and read
  handlers in `app/api/webhook/route.ts` depend on those events, and relying on them
  arriving under the default subscription is fragile.
- `README.md` claims a follow gate that "fails open". Confirm that behaviour with a test
  before relying on it commercially — a silent fail-closed loses real leads.
- The 5-minute read-fallback delay is a hardcoded constant. Make it per-campaign only if a
  client actually asks; not before.

### Phase 4 — Facebook Pages (only after Phase 1–2 ship)

Same Meta app, `feed` webhook field, Facebook Login. The queue, worker, rate limiter,
tracked links, and logging all carry over untouched. The work is a second provider client
and a `platform` discriminator on the account model.

---

## 5. Decisions still open

- Hosting: Vercel + Railway (README's path) vs. the Dokploy self-host guide in
  `docs/deploy-dokploy.md`. Vercel is faster to prove the concept; the worker must live
  somewhere long-running either way.
- Single account or agency multi-workspace from day one? The code supports both; the Meta
  app review burden differs a lot.
- Does the roadmap include WhatsApp? If yes, register the phone number early — template
  approval has real lead time.

---

### Note

You asked for `cloud.md`. There is already a `CLAUDE.md` in this repo (it just contains
`@AGENTS.md`, a Next.js 16 instruction). If you meant this file to be the AI assistant's
instruction file, say so and I'll merge it into `CLAUDE.md` instead.

---

# Part 2 — Local setup log (2026-08-22)

Everything below was actually executed and verified on this machine, not proposed.

## Changes made to the repo

| File | Change | Why |
|---|---|---|
| `.env` | **Created** (gitignored) | Fresh `NEXTAUTH_SECRET`, `CRON_SECRET`, `ENCRYPTION_KEY` (64 hex), `WEBHOOK_VERIFY_TOKEN`. Meta vars still blank. |
| `package.json:13` | `"worker": "tsx worker/dm-worker.ts"` → `"tsx --env-file-if-exists=.env worker/dm-worker.ts"` | **Real bug fix.** `next dev` auto-loads `.env`; `tsx` does not, and nothing under `worker/` or `lib/` imports `dotenv`. The worker would start with no `DATABASE_URL` and throw at the first heartbeat — while `lib/queue/client.ts:14` uses `process.env.REDIS_URL!` (non-null assertion), so ioredis *silently* connects to the default `127.0.0.1:6379` and looks fine. `--env-file-if-exists` is a no-op in production where the platform injects env vars. Worth upstreaming. |
| `docker-compose.override.yml` | **Created** (gitignored) | Ports 5432/6379 are already taken on this machine by an unrelated `postiz` stack. Remaps Postgres to **5434** and Redis to **6380**. Needs the `!override` tag — compose *appends* list fields by default, so a plain override tried to bind both ports and failed. |
| `.gitignore` | +1 line for `docker-compose.override.yml` | Machine-specific ports must not be committed. |
| `next.config.ts` | Added `allowedDevOrigins`, derived from `NEXTAUTH_URL` | **Dev-only, but it made the app look completely broken.** Serving `next dev` through the ngrok tunnel meant Next blocked every cross-origin `/_next/*` request (`Blocked cross-origin request to Next.js dev resource`). Page HTML returned 200, but the client chunks never loaded, so React never hydrated and every page sat on its loading skeleton forever — Dashboard, Overview, Inbox, Campaigns, DM Logs, Settings. The tell in the log was that **no `/api/*` request ever arrived**, only page routes. Derived from `NEXTAUTH_URL` rather than hardcoded so it follows the tunnel domain; ignored in production. |
| `lib/meta/oauth.ts:10` | `INSTAGRAM_OAUTH_URL` `api.instagram.com` → `www.instagram.com` | **Real bug fix — blocked the whole product.** Clicking *Connect Instagram* landed on *"Sorry, this page isn't available"*. `api.instagram.com/oauth/authorize` was the **Basic Display API** host, deprecated Dec 2024, and now returns **HTTP 404**; `www.instagram.com/oauth/authorize` returns 200. Verified both with curl side by side. The **token** endpoint at `api.instagram.com/oauth/access_token` is unaffected and still correct (probed: returns `400 Invalid authorization code`, not 404) — so only the authorize constant moves. Definitely worth upstreaming. |

Not changed: `README.md:63-72` omits `npm run db:generate`, so its quickstart crashes on a
fresh clone (`app/generated/prisma` is gitignored and neither `next dev` nor
`prisma migrate deploy` creates it). `docs/setup.md:245-249` has the correct order. Left
alone — worth an upstream PR, not needed for us.

## Local ports on this machine

| Service | Port | Note |
|---|---|---|
| Web app | 3000 | `npm run dev` |
| Postgres | **5434** | remapped from 5432 |
| Redis | **6380** | remapped from 6379 |
| Mailpit SMTP | 1025 | login emails |
| Mailpit web UI | **8025** | read the magic link here |
| ngrok inspector | 4040 | |

## Run it again from cold

```bash
open -a Docker                                    # wait for the daemon
docker compose up -d                              # postgres + redis
docker start mailpit                              # login-email catcher
npm run dev                                       # terminal 1
npm run worker                                    # terminal 2
ngrok http 3000 --url=filtratable-reforgeable-alba.ngrok-free.dev   # terminal 3
```

First-time-only, already done: `npm install`, `npm run db:generate`, `npm run db:migrate`.

## Login has no dev bypass

`lib/auth.ts:24-31` has exactly one provider — no Credentials fallback, no `NODE_ENV`
branch, no console-logged magic link. A deliverable email is mandatory. Instead of signing
up for Resend just to log in locally, `EMAIL_SERVER=smtp://localhost:1025` points at a
Mailpit container and the link is read at http://localhost:8025. Resend is still required
for production.

## Verified working

- `/api/health` → `200 {"status":"ok"}`, all four checks green (database, redis, queue, worker heartbeat).
- 19 Prisma migrations applied to an empty DB.
- Magic-link login → session created → `/dashboard` 200 → workspace auto-provisioned.
- `npm run typecheck` clean · `npm run lint` clean · `npm test` **142 passed / 14 files**.
- ngrok tunnel reaches the app over HTTPS end to end.

## Still open

- Static ngrok domain: **`filtratable-reforgeable-alba.ngrok-free.dev`** (reserved to the account —
  verified by rebinding it explicitly with `--url` after a full tunnel restart). `NEXTAUTH_URL`
  is set to it and `/api/health` is green over public HTTPS.
- Meta app not created — `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET` still blank in `.env`.
- **`abdalrhmanraed` has not accepted its tester invite** (`abd_thawabteh` has). Needed before
  the DM test: with the app unpublished it holds only **Standard Access**, so it can only
  message accounts that hold a role on the app. Accept at
  `https://www.instagram.com/accounts/manage_access/` → **Tester Invites** → `Business-IG`.
  That tab exists on **web only** — the mobile Instagram app does not surface it, which costs
  people hours.

## Instagram connection — verified live

`abd_thawabteh` (`17841405671850428`) connected, token encrypted, `webhookSubscribed = true`.
All data APIs return real data: `/api/dashboard/stats`, `/api/instagram/accounts`,
`/api/automations`, `/api/logs`, and `/api/instagram/posts` (**143 real posts**). The campaign
builder renders the post picker and the live DM preview.

---

## Why campaigns showed "0 runs" — and a correction to Part 1

**Not a code bug.** Everything on our side was working:

- Worker alive, heartbeat healthy, poller sweeping every 5 min since boot.
- `recordSweep` writes an `OperationalEvent` only when something was enqueued **or** an error
  occurred (`lib/polling/comment-reconciler.ts:254`). Zero rows meant sweeps ran **cleanly**
  and simply found nothing — not that they crashed.
- Both campaigns correct and `isActive`. Both Instagram testers accepted.

**The real cause, proved with the live token:**

| Query | Result |
|---|---|
| `/{ig-user-id}/media` → `comments_count` on post `18170086765453229` | **9** |
| `/{media-id}/comments` (same token, same post) | **0** |

Instagram reports 9 comments and returns none of them. Not a field-permission filter —
probed with no fields, minimal fields, and the repo's exact field set: all returned 0, with
no API error.

The app is in **Development mode (Unpublished)**. In that state the Graph API does not serve
comment data.

### The correction

Part 1 planned around the polling reconciler letting us skip publishing the Meta app. That
was **wrong**. The poller bypasses **webhooks**, but not the **access level** — it calls the
very same Graph API, which is gated by the app's publish state. Publishing is not optional.

### What publishing does and does not buy

Publishing moves the app to **Live** with **Standard Access**, which covers only accounts
holding a role on the app. Concretely:

- ✅ Comments from **`abdalrhmanraed`** (Instagram Tester) → will work.
- ❌ The 9 comments from ordinary followers → still invisible. Those need **Advanced Access**
  to `instagram_business_manage_comments`, which requires **App Review** plus **business
  verification** (`META_APP_REVIEW.md:44`).
- ⚠️ Comments from **`abd_thawabteh`** never fire regardless — it is the connected account and
  the code skips its own comments by design (`lib/meta/webhook.ts:117-121`), because Meta
  rejects a private reply to yourself.

So the test must be: comment from **`abdalrhmanraed`** on a post owned by **`abd_thawabteh`**.

**This is the gate on running OpenReply for real customers**, not a local setup detail: until
App Review grants Advanced Access, the tool only ever responds to accounts you have added as
testers.

Publish prerequisites — all three verified live (HTTP 200):
`/privacy` · `/terms` · `/data-deletion`

---

# Part 3 — WORKING (2026-08-22)

## Publishing was the fix

App published (`Business`, ID `2901649213548346`). Before/after on the exact same token and post:

| | Before publish | After publish |
|---|---|---|
| `/{media}/comments` on post `18170086765453229` | **0** | **8** |

Set during publish: `/privacy`, `/terms`, `/data-deletion` URLs and Category = *Business and pages*.
Meta then reported "All required app settings are complete."

## First successful comment→DM run

Sweep log (`OperationalEvent`):

```
"test automation" [claude,hi]     : 3 matched, 3 enqueued, 0 errors
"another test"    [(any word)]    : 1 matched, 1 enqueued, 0 errors
```

`DmLog` — 4 rows, all **SENT**, no errors, delivered 07:04:57–07:04:58:

| commenter | comment | matched keyword | status |
|---|---|---|---|
| abdalrhmanraed | `hi` | `hi` | SENT |
| abdalrhmanraed | `claude` | `claude` | SENT |
| abdalrhmanraed | `Claude` | `claude` | SENT (case-insensitive confirmed) |
| abdalrhmanraed | `salam` | — (any-word campaign) | SENT |

Delivered by the **polling reconciler**, not webhooks — `WebhookEvent` was still 0 at that point.

## Correction to Part 2

Part 2 predicted that Standard Access would hide comments from ordinary followers and only
expose tester accounts. **That was too pessimistic.** After publishing, the comments edge
returns everyone — @ti_8ip, @rdd66631, @eihab07, @brahim_amro and others all came back. The
gate was the app being unpublished, not the commenter lacking a role.

Still unverified: whether a *private reply* can be **sent** to a non-tester. All four
confirmed sends went to `abdalrhmanraed`, which is a tester. Test with a non-tester commenter
before assuming Advanced Access is unnecessary.

## Webhooks now live (instant instead of ≤5 min)

- Callback `https://filtratable-reforgeable-alba.ngrok-free.dev/api/webhook`, verify token from `.env`.
- Meta's challenge hit the server and returned **200** (confirmed in the dev log).
- Account subscription verified via API:
  `subscribed_apps -> [{"id":"18450348835189062","subscribed_fields":["comments","messages"]}]`
- Use-case sections 1, 3 and 4 all green.

## Repo bugs found and fixed (all worth upstreaming)

1. `lib/meta/oauth.ts:10` — OAuth pointed at the dead `api.instagram.com` host (404).
2. `package.json:13` — worker never loaded `.env`.
3. `next.config.ts` — no `allowedDevOrigins`, so every page hung on its skeleton behind a tunnel.

## Remaining

- **App Review + business verification** for Advanced Access, if non-tester commenters turn
  out to need it.
- The tunnel process must stay running. If it dies:
  `ngrok http 3000 --url=filtratable-reforgeable-alba.ngrok-free.dev` — same URL, no Meta reconfiguration.
- Production deploy (Vercel + Railway) still pending.

---

# Part 4 — Access model, limits, and risk (verified against Meta docs, 2026-08-22)

## Settled: a fully external commenter works

An account with **no role on the app and no link to the Facebook account** commented, and the
automation fired and delivered. This closes the question left open in Part 3 and **corrects
the caution there**: the commenter never needs a role. Standard Access was never about them.

## Where the Standard / Advanced line actually falls

Meta's App Review docs define it by **whose Instagram account is connected**, not by who
interacts with it:

| | Standard Access (what we have) | Advanced Access |
|---|---|---|
| Meta's wording | *"a business I own or manage"* | *"I am a Tech Provider and my app serves multiple businesses"* |
| Connect **your own** accounts | ✅ | not needed |
| Connect **clients'** accounts | ❌ | ✅ required |
| App Review | not required | required |
| Business verification | not required | required (needs a registered legal entity) |

So: **running OpenReply on your own Instagram accounts needs nothing further.** The moment a
customer connects *their* account, App Review + business verification become mandatory.

## Rate limits (per Instagram professional account)

| API | Limit |
|---|---|
| **Private Replies** — posts and reels | **750 / hour** |
| Private Replies — live comments | 100 / second |
| Send API — text, links, reactions | 100 / second |
| Conversations API | 2 / second |

The repo already enforces the 750/hour cap and **queues** the overflow rather than dropping
it (`lib/utils/rate-limiter.ts`), so a viral reel degrades into a delay, not lost DMs.

## Messaging rules that matter

- **24-hour window** — the app may only reply within 24 hours of the user's own action
  (comment, DM, story reply, story mention). Outside it, only the `human_agent` tag (7 days).
- **Automated-experience disclosure** — Meta requires disclosing automation at the start of a
  thread, and specifically calls out California and German users.
- One private reply per comment; the repo is idempotent per `commentId` (`DmLog` unique on
  `automationId + commentId`), so retries cannot double-send.

## Ban risk — the honest read

Low, because of *how* this is built, not because of luck:

- Official Graph API only. No scraping, no browser automation, no password handling.
- Replies only on the connected account's own media.
- Under Meta's own documented cap, with overflow queued.
- Self-comment filtering and per-comment dedup prevent loops and doubles.

What would actually put the account at risk: unsolicited/bulk DMs to people who did not
interact, messaging outside the 24-hour window, identical spammy copy at volume, or missing
the automation disclosure. Those are policy violations regardless of tooling.

---

# Part 5 — Story-reply automation (built 2026-08-22)

## What it does

New per-campaign trigger: **`storyReplyTriggerEnabled`** — fire when someone replies to one of
the account's stories.

| Flag | Fires on |
|---|---|
| `dmTriggerEnabled` (existing) | **any** inbound DM, story replies included |
| `storyReplyTriggerEnabled` (new) | **story replies only** |

Both can be on. Keyword matching is untouched, so `matchAnyWord` gives "reply to *any* story
reply" for free — no extra field.

## Why it was small

Instagram has **no comments on stories**. A story reply is delivered on the `messages` webhook
we already subscribe to, as an ordinary message carrying `reply_to.story`. So story replies
*already* reached the worker — they were simply indistinguishable from a plain DM. The feature
is one flag threaded through, not a new pipeline. **No Meta console changes**: `messages` was
already subscribed and `instagram_business_manage_messages` already granted.

## Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260822080000_add_story_reply_trigger/` | `storyReplyTriggerEnabled Boolean @default(false)` |
| `lib/meta/webhook.ts` | `reply_to` on the message type; `isStoryReply` on `WebhookMessageEvent`, **spread in only when true** so a plain DM keeps its exact previous shape (the existing tests use strict `toEqual`) |
| `lib/queue/client.ts` | `isStoryReply?: boolean` on `ProcessMessageJob` — optional, so jobs queued before the deploy stay valid |
| `app/api/webhook/route.ts` | pass the flag into `queue.add` (hand-listed object, not a spread) |
| `lib/queue/dm-worker.ts` | conditional `triggerWhere`: story replies match `OR: [dmTriggerEnabled, storyReplyTriggerEnabled]`; ordinary DMs keep `dmTriggerEnabled` top-level |
| `app/api/automations/route.ts` | create schema, update schema, and the explicit `create({ data })` |
| `components/campaign-builder.tsx` | toggle mirroring the `dmTriggerEnabled` block |
| `components/campaign-preview.tsx` | reuses the existing `dmTrigger` thread, relabelled **"Story reply"** — no fifth tab |
| `app/(dashboard)/campaigns/[id]/page.tsx` | summary line |

The dedupe key stays `dm:${messageId}` — changing it would risk a double-send for any message
already in flight.

## Deliberately skipped

- **Story mentions** (someone tags you in *their* story). They arrive with no text at all, so
  they cannot be keyword-gated and need the attachment-only guard at `lib/meta/webhook.ts:208`
  relaxed plus their own opt-in column. Add when actually wanted.
- **Per-story targeting** — stories expire in 24h, so targeting one is near-worthless.
- A separate preview tab — a story reply renders as the same DM thread.

## Verified

- `npm test` **147 passed** (was 142; +3 webhook parse, +2 worker selection) · typecheck clean · lint clean
- Migration applied; `storyReplyTriggerEnabled` present on `Automation`
- `/api/health` `ok`, worker healthy; the field round-trips through `GET /api/automations`
- UI live: toggle, helper text, and the **"Story reply"** preview tab

The two worker tests are the ones that matter — one asserts a story reply widens the query to
both flags, the other asserts a plain DM does **not**, which is the whole point of the separate
flag.

## Not yet proven — needs a live story

Meta populating `reply_to.story` is documented but **unverified on this account**. To confirm:
post a story from `abd_thawabteh`, reply to it from `abdalrhmanraed`, then inspect the raw
payload — it is already captured, no extra code needed:

```sql
SELECT payload FROM "WebhookEvent" ORDER BY "createdAt" DESC LIMIT 1;
```

Then the real test: a campaign with **only** `storyReplyTriggerEnabled` on must fire for a
story reply and stay **silent** for an ordinary DM.

---

# Part 6 — Per-story targeting (built 2026-08-22)

## What it does

"a story" is now a peer of post/reel in the trigger radio, ManyChat-style. Pick it, then choose
**any story** or **a specific story** from a live picker of currently-active stories. Pinning to
one story is what makes a story *sequence* work — story #2 in a sequence can carry its own
campaign without stories #1 and #3 firing it.

## Verified before building, not assumed

**The webhook already carries the story id** — from the real payload of the user's own
successful story reply:

```json
"reply_to": { "story": { "id": "17899092177578791", "url": "..." } }
```

**The stories endpoint works on this account** — tested with the live decrypted token:
`GET /me/stories` → HTTP 200, and the id matched the webhook exactly. No new Meta permission
(`instagram_business_basic` covers it), no console change.

## Semantics

| `storyReplyTriggerEnabled` | `storyId` | Fires on |
|---|---|---|
| false | — | never (story replies ignored) |
| true | `null` | replies to **any** story |
| true | set | replies to **that one story** only |

Worker selection (`lib/queue/dm-worker.ts`), flat OR arms so ordinary DMs keep
`dmTriggerEnabled` top-level:

```ts
OR: [
  { dmTriggerEnabled: true },
  { storyReplyTriggerEnabled: true, storyId: null },
  ...(storyId ? [{ storyReplyTriggerEnabled: true, storyId }] : []),
]
```

A story reply with **no** id can only ever match an "any story" campaign — a pinned campaign
must not fire on an unidentified story. There is a test for exactly that.

## Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` + `migrations/20260822110000_add_story_target/` | `storyId String?` |
| `lib/meta/webhook.ts` | carry `reply_to.story.id`, spread in only when present |
| `lib/queue/client.ts`, `app/api/webhook/route.ts` | thread `storyId` into the job |
| `lib/queue/dm-worker.ts` | the three-arm OR above |
| `lib/meta/client.ts` | **new** `getUserStories()` — no pagination; a 24h window is not a library |
| `app/api/instagram/stories/route.ts` | **new**, mirrors the posts route, `dynamic = "force-dynamic"` |
| `components/story-picker.tsx` | **new** — no caption search, no pagination, no session cache; shows "expires in Xh" and flags a pinned story that has since expired |
| `components/campaign-builder.tsx` | `"story"` trigger scope + nested any/specific + picker; hydration branch placed **before** the `"specific"` fallback, which otherwise swallows every post-less campaign |
| `app/api/automations/route.ts` | `storyId` in both schemas + create; **refine widened** |
| `app/(dashboard)/campaigns/[id]/page.tsx` | summary says "one specific story" vs "a story" |

## Pre-existing bug fixed along the way

`app/api/automations/route.ts` required `matchAnyPost || pendingNextReel || postId`, so **any
post-less campaign was rejected**. That already forced a DM-only campaign to pick a post it
never used. The predicate now also accepts `storyReplyTriggerEnabled || dmTriggerEnabled`.

## Meta compliance

Only the story **id** is persisted. `media_url` is display-only and re-fetched live every time
the picker opens — Meta forbids storing or caching story media.

## Verified

- **150 tests passing** (was 147) · typecheck clean · lint clean
- Migration applied; `/api/health` ok, worker healthy
- `GET /api/instagram/stories` returns the live story (`17899092177578791`)
- UI confirmed: "a story" radio → any/specific → picker rendering the real story with
  **"expires in 22h"**

## Not yet proven — needs two stories

Post **two** stories, pin a campaign to story #1, then from `abdalrhmanraed` reply to **both**.
Story #1 must fire and **story #2 must not** — that second half is what distinguishes real
targeting from an alias for "any story".
