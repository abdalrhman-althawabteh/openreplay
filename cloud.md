# cloud.md — OpenReply project reference

**Last updated: 2026-08-22.** Single source of truth for this project: what it is, what we
changed, what is deployed, what is left, and every trap we hit. Written to be read cold —
assume no memory of the conversation that produced it.

> ⚠️ **This file is committed to a PUBLIC GitHub repo. Never put secrets in it.** Secret values
> live in `.env` (gitignored) and in Railway/Vercel environment variables. This file names
> variables, never their values.

---

# 1. What this project is

**OpenReply** — an open-source ManyChat alternative for Instagram. Someone comments a keyword on
your post/reel (or replies to your story) and gets a DM with your link.

- **Working from:** `/Users/admin/Downloads/claude code projects/openreplay`
- **Our repo:** `https://github.com/abdalrhman-althawabteh/openreplay` (public, branch `main`)
- **Upstream:** `https://github.com/diwenne/openreply` — git remote `upstream`, for pulling
  fixes or sending PRs back
- **Owner's use:** personal only. **Not** a SaaS for clients — this decision matters, see §5.1.

## Stack

Next.js 16 (App Router, Turbopack, React 19) · Prisma 7 + PostgreSQL · BullMQ on Redis ·
Auth.js v5 email magic links · Tailwind 4 · Vitest · TypeScript.

**Two processes, always:**
1. **Web app** (`npm run dev` / Vercel) — dashboard, API routes, receives Meta webhooks.
2. **Worker** (`npm run worker` / Railway) — drains the BullMQ queue and actually sends DMs.
   Also runs a **comment poller every 5 min** as a safety net for webhooks Meta never delivers.

If DMs never arrive, **check the worker first.** `/api/health` reports `worker.healthy`.

---

# 2. Identities and IDs (no secrets)

| Thing | Value |
|---|---|
| Domain (owned) | `a58lab.com` — DNS at **Namecheap** (`dns1/dns2.registrar-servers.com`). Replaced `leads-alchemy.online` on 2026-09-17 when its subscription lapsed. |
| App URL (target) | **`openreply.a58lab.com`** |
| Temporary dev URL | `filtratable-reforgeable-alba.ngrok-free.dev` — **being retired**, see §6 |
| Meta app name | `Business` |
| **Facebook** App ID | `2901649213548346` |
| **Instagram** App ID | `2484605788695559` ← different number, easy to confuse |
| Connected IG account | `abd_thawabteh`, IGID `17841405671850428` (Business, app admin) |
| Second IG account | `abdalrhmanraed` — Instagram Tester, the commenter for tests |
| Railway project | `trustworthy-creativity` · `83f542b3-c97d-4bfd-8dda-02df6b352bd3` (Hobby, $5/mo) |
| Postgres public host | `reseau.proxy.rlwy.net:21321` |
| Login email | `abdalrhman.althawabteh@gmail.com` |

Secret **names** in use: `NEXTAUTH_SECRET`, `CRON_SECRET`, `ENCRYPTION_KEY` (must be exactly 64
hex chars), `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`,
`RESEND_API_KEY` / `EMAIL_SERVER`.

---

# 3. What we built

## 3.1 Story-reply automation (new feature, ours)

Instagram has **no comments on stories**. Meta delivers two different things on the `messages`
webhook we already subscribe to:

| What | Payload shape | Status |
|---|---|---|
| **Story reply** | normal message + `reply_to.story = {id, url}` | built |
| Story mention (they tag you) | message with **no text**, `attachments[0].type == "story_mention"` | not built — no text means no keyword gate, needs its own opt-in column |

Real payload, captured from a live reply:

    "reply_to": { "story": { "id": "17899092177578791", "url": "https://lookaside.fbsbx.com/..." } }

**Two new columns on `Automation`:**

| Column | Meaning |
|---|---|
| `storyReplyTriggerEnabled` | fire on story replies |
| `storyId` | `null` = any story · set = **that one story only** |

Worker matching lives in `processMessage` (`lib/queue/dm-worker.ts`): a story reply widens the
query to three OR arms — every-DM campaigns, any-story campaigns, and (only when an id is
present) campaigns pinned to that exact story. Ordinary DMs keep `dmTriggerEnabled` as a
**top-level** key on purpose, which keeps the existing worker test green. A story reply with
**no** id can only match an "any story" campaign.

**UI:** `a story` is now a peer of post/reel in the trigger radio (ManyChat-style) → then
`any story` / `a specific story` → live picker (`components/story-picker.tsx`) showing
"expires in Xh", backed by new `getUserStories()` and `app/api/instagram/stories/route.ts`.

**Deliberately simpler than the post picker:** no caption search (stories have no captions), no
pagination (a 24h window is never big), no session cache (a cached thumbnail of an expired story
is worse than a spinner).

**Meta compliance:** only the story **id** is persisted. `media_url` is display-only and
re-fetched live — Meta forbids storing story media.

## 3.2 Four bugs fixed (all upstream-worthy)

These break OpenReply for **any** new user. Worth a PR to `upstream`.

| File | Bug | Symptom |
|---|---|---|
| `lib/meta/oauth.ts` | OAuth pointed at `api.instagram.com` — the **deprecated Basic Display host**, dead since Dec 2024, now **404** | "Sorry, this page isn't available" instead of a consent screen. Moved to `www.instagram.com`. The **token** endpoint on `api.instagram.com` is still correct and was left alone (verified: returns `400 Invalid authorization code`, not 404). |
| `package.json` | worker never loaded `.env` | `next dev` auto-loads it, `tsx` does not, and nothing under `worker/` imports `dotenv`. Worker booted with no `DATABASE_URL` — while `lib/queue/client.ts` uses `process.env.REDIS_URL!` (non-null assertion) so ioredis *silently* fell back to a default and looked healthy. Fixed with `--env-file-if-exists=.env`. |
| `next.config.ts` | no `allowedDevOrigins` | Behind an HTTPS tunnel, Next blocked its own `/_next/*` client chunks. Page HTML returned 200 but React never hydrated — **every page stuck on a loading skeleton**. The tell: no `/api/*` request ever reached the server, only page routes. Derived from `NEXTAUTH_URL` so it follows the tunnel. |
| `app/api/automations/route.ts` | refine demanded a post | Any post-less campaign was rejected, so **DM-only campaigns were forced to pick a post they never use**. Widened to also accept `storyReplyTriggerEnabled` or `dmTriggerEnabled`. |

## 3.3 Local-only config (not committed)

- `.env` — gitignored.
- `docker-compose.override.yml` — gitignored. Remaps Postgres to **5434** and Redis to **6380**
  because 5432/6379 are taken by an unrelated `postiz` stack on this machine. Needs the
  `!override` tag; Compose **appends** list fields by default, so a plain override tried to bind
  both ports and failed.

---

# 4. Current state

## 4.1 Local (running, dies with the terminal session)

| Piece | Where |
|---|---|
| Web app | `localhost:3000` |
| Postgres | **5434** (docker) |
| Redis | **6380** (docker) |
| Mailpit (login emails) | SMTP 1025, **web UI `localhost:8025`** |
| Tunnel | ngrok static domain |

**Login has no dev bypass.** `lib/auth.ts` has exactly one provider — no Credentials fallback,
no `NODE_ENV` branch, no console-logged link. Locally we point `EMAIL_SERVER` at Mailpit and
read the magic link at `localhost:8025`.

Cold start:

    open -a Docker                     # wait for the daemon
    docker compose up -d               # postgres + redis
    docker start mailpit
    npm run dev                        # terminal 1
    npm run worker                     # terminal 2
    ngrok http 3000 --url=filtratable-reforgeable-alba.ngrok-free.dev   # terminal 3

First time only: `npm install` (**not** `npm ci --omit=dev` — `prisma.config.ts` imports
`dotenv/config` but `dotenv` isn't a declared dependency; it only resolves by hoisting),
`npm run db:generate` (**the README omits this, so its quickstart crashes**), `npm run db:migrate`.

## 4.2 Production — Railway: DONE

Hobby plan, project `83f542b3-c97d-4bfd-8dda-02df6b352bd3`.

| Service | State |
|---|---|
| Postgres | Online · **17 tables migrated** · public access on |
| Redis | Online |
| `openreplay` (worker) | Online · log shows `[DM Worker] Started` |

Worker: Build `npm run db:generate`, Start `npm run worker`, 11 env vars using Railway variable
references for `DATABASE_URL` and `REDIS_URL` so it uses the **private** network (no egress billed).

## 4.3 Production — Vercel: DONE

Project `openreplay` under team `abds-projects-4060b6c7` (Hobby), deployed from GitHub.

- **Live at `https://openreply.a58lab.com`** — `/api/health` returns `ok` with all
  four checks green, including the Railway worker's heartbeat seen from Vercel.
- 13 env vars set via the **Vercel CLI** (`vercel env add`), not the dashboard — see the traps.
- DNS: `A openreply -> 76.76.21.21` at Namecheap. Existing `@`, `www` and Google MX untouched.

## 4.3b Email — Resend: DONE

Sending domain **`mail.a58lab.com`** (a subdomain on purpose — the root already has
Google Workspace MX and Resend's MX would have clashed).

All three records **verified**: DKIM `TXT resend._domainkey.mail`, `CNAME rsend.mail -> rsend-apne1.forge.rmta.net`,
`CNAME send.mail -> send.forge.rmta.net` (Resend moved from MX+TXT to CNAMEs in 2026-09). Domain reports
`partially_verified`, which is Resend's wording when sending is verified but optional
receiving/DMARC is not — sending works.

`EMAIL_FROM = OpenReply <login@mail.a58lab.com>`, API key `openreply-production`.

## 4.4 Verified working

- Comment → DM: **4 DMs sent**, `SENT`, no errors, case-insensitive matching confirmed
- Story reply → DM: confirmed live by the owner
- **150 tests passing**, typecheck clean, lint clean, 21 migrations
- A **fully external** commenter (no app role, no link to the FB account) triggered it successfully

**Re-verified end to end on `openreply.a58lab.com` (2026-08-22, after the #9 fix):**

- Campaign built in the production UI (post picker, keyword, message, link button) — saved fine
- Comment `vtest` from `abdalrhmanraed` → DM **in the same second** (14:55:0x → 14:55:11 UTC).
  Before the fix the identical test took ~90 s and `/diagnostics` credited the comment sweep.
- Story reply → DM fired too, from the backlog Meta flushed on save
- DM payload read back from Graph API to prove the link survives:
  `attachments.data[0].generic_template.cta[0].url` = `https://openreply.a58lab.com/r/…`
  — so **the worker's `NEXTAUTH_URL` is correct** (trap #7 is clear)
- Tracked link `302 →` destination, click recorded, campaign CTR 100 %
- `/api/health` green including the Railway worker's heartbeat seen from Vercel

**Instagram web does not render the CTA button.** The thread shows the title text only and the
inbox preview says *"sent an attachment"*. This is a client-side rendering gap, **not** a bug —
the button is in the payload and shows in the mobile app. Read it back with:

    GET /{message-id}?fields=attachments

---

# 5. Meta platform facts (verified against docs)

## 5.1 Access levels — the line that actually matters

Defined by **whose Instagram account is connected**, not who interacts with it:

| | Standard Access (what we have) | Advanced Access |
|---|---|---|
| Meta's wording | *"a business I own or manage"* | *"I am a Tech Provider and my app serves multiple businesses"* |
| Your own accounts | works | not needed |
| **Clients'** accounts | blocked | required |
| App Review | not required | required |
| Business verification | not required | required (registered legal entity) |

**Because this is personal-use only, nothing further is needed.** App Review only becomes
mandatory if the owner ever lets other people connect their own Instagram accounts.

## 5.2 The app MUST be published

**Publishing was the single fix that made everything work.** Before/after on the same token and
post: `/{media}/comments` returned **0** while unpublished, **8** after publishing. Instagram
reports `comments_count` but serves no comment data to a Development-mode app.

⚠️ **An earlier assumption in this project was wrong and cost hours:** the polling reconciler
does *not* let you skip publishing. It bypasses **webhooks**, not the **access level** — it calls
the same Graph API, which is gated by publish state.

## 5.3 Rate limits (per Instagram professional account)

| API | Limit |
|---|---|
| **Private replies — posts & reels** | **750 / hour** ← the one that matters |
| Private replies — live comments | 100 / sec |
| Send API — text, links | 100 / sec |
| Conversations API | 2 / sec |

The repo enforces the 750/hour cap and **queues** overflow rather than dropping it.

## 5.4 Policy rules

- **24-hour window** — you may only reply within 24h of *their* action (comment, DM, story
  reply). Outside it, only the `human_agent` tag (7 days).
- **Automation disclosure** required at the start of a thread; Meta names California and Germany.
- One private reply per comment. The code is idempotent per `commentId`.

**Ban risk is low, and that is structural:** official Graph API only, no scraping, no browser
automation, never touches the password, replies only on the account's own media, under Meta's
documented cap. What *would* get you restricted: DMing people who never interacted, messaging
outside the 24h window, identical spam at volume, hiding the automation disclosure.

## 5.5 Versus ManyChat

**Identical permissions** — same three Instagram scopes, same 750/hour cap. ManyChat has no
privileged access; they are simply a Tech Provider with Advanced Access, which is what lets them
onboard *other people's* accounts. They stay ahead on multi-step flows, tags/segmentation,
broadcasts, and other channels. The core comment→DM engine is at parity.

---

# 6. Why we are leaving ngrok

Two real failures, both hit by an actual follower:

1. **`ERR_NGROK_6024`** — every first-time visitor to a tracked DM link sees ngrok's warning:
   *"You should only visit this website if you trust whoever sent the link to you."* Devastating
   for a link-in-DM product. **No free workaround** — it can only be skipped with an HTTP header,
   which a browser navigation cannot send. We never saw it because dismissing it sets a cookie.
2. **`ERR_NGROK_3200`** — the tunnel dropped while a follower was clicking. Dead link.

**Accepted casualty:** 3 tracked links already sent in DMs point at the ngrok domain and **die
permanently** once it is gone. New DMs use the new domain.

## The complete URL inventory — 9 places

Missing any one breaks something quietly:

**All 9 are now pointed at `openreply.a58lab.com`** (the ngrok OAuth redirect was
deliberately *kept alongside* the new one — Meta allows multiple, so local dev still works).

| # | Where | Setting | Breaks if wrong |
|---|---|---|---|
| 1 | Meta → Instagram → **Business login settings** | OAuth redirect URI | Connecting an account fails |
| 2 | Meta → Use cases → Customize → **Webhooks → Instagram** | Callback URL | Nothing — see #9. This screen is *not* the one that delivers for an Instagram-login app. |
| 2b | Meta app-level subscription (`GET /{app-id}/subscriptions`) | `callback_url` + `fields` | Mirrors #2; must list `comments` and `messages` |
| 3 | Meta → App settings → Basic | Privacy policy URL | publishing / review |
| 4 | Meta → App settings → Basic | Terms of Service URL | same |
| 5 | Meta → App settings → Basic | Data deletion URL | same |
| 6 | **Vercel** env | `NEXTAUTH_URL` | login links, OAuth redirect |
| 7 | **Railway worker** env | `NEXTAUTH_URL` | **tracked DM links point at the old domain** |
| 8 | Local `.env` | `NEXTAUTH_URL` | local dev only |
| **9** | Meta → Instagram API → **API setup with Instagram login → 3. Configure webhooks** | Callback URL | **ALL webhook delivery stops.** This is the effective config for this app. |

**#7 is the trap:** `buildTrackedUrl` runs in the **worker**, not the web app. A worker left on
the old URL keeps sending dead links after everything else looks correct.

**#9 is the bigger trap, and it cost a whole extra test round (2026-08-22).** There are *two*
webhook screens in the Meta console and they are not the same setting. #2 is the generic
"Use cases → Customize → Webhooks" page. #9 lives inside the Instagram-login product itself.
For **Instagram API with Instagram login** — which is what this app uses — **only #9 delivers.**
Meta says so in a banner on screen #2: *"Webhook configurations for Instagram API with Instagram
business login are supported only within the product itself."*

#2, #2b and the per-account `subscribed_apps` all read perfectly correct while #9 still pointed
at the dead ngrok tunnel, so **every diagnostic looked green and zero webhooks arrived.** The
symptom is silent and specific: comment→DM still works but always lands ~1–5 min late, and
`/diagnostics` shows every send preceded by a `Comment sweep … 1 enqueued` line. That means the
**poller** did it, not the webhook. Story replies fail *completely* — the poller only sweeps
comments, never `messages`.

Fastest way to tell webhooks apart from the poller:

    npx vercel logs openreply.a58lab.com | grep -i 'api/webhook'

No `POST /api/webhook` around the time you commented ⇒ Meta is not delivering, and #9 is the
first place to look. Note editing #9 requires **re-typing the verify token** — Meta greys out
"Verify and save" until you do, with the tooltip *"Re-enter your verify token."* Saving #9 did
**not** wipe the field subscriptions (unlike #2), and Meta immediately flushes its queued
backlog, so expect a burst of deliveries — and a burst of real DMs — the moment it saves.

---

# 7. Decisions already made (do not re-litigate)

| Decision | Rationale |
|---|---|
| **Subdomain**, not `leads-alchemy.online/openreply` | A subpath needs Next.js `basePath`, which rewrites every route, consumes the apex domain (bare domain becomes 404), lengthens every DM link, and has Auth.js edge cases. Owner was flexible. |
| **Railway for everything**, ~$5/mo | The free trial had expired; the free plan's $1/mo credit does not cover a 24/7 worker. Owner subscribed to Hobby. |
| **Resend** free tier for login email | 3,000/mo, only needed for the owner's own logins. |
| Expired targeted story → **just stops matching**, labelled in the UI | No auto-deactivation, no silent widening to "any story". |
| **No** "next story" auto-attach | Deferred. |
| **No** story mentions | Deferred — needs its own opt-in column. |
| Personal use, **no App Review** | Only needed to onboard other people's accounts. |

---

# 8. Traps and gotchas (the expensive lessons)

**Meta console**
- There is **no "Instagram" sidebar item.** Everything is under **Use cases → Customize**.
- The **Instagram App ID is not the Facebook App ID.**
- `instagram_business_manage_comments` was **not** added by Meta's own "Add all required
  permissions" button — it added the legacy `instagram_manage_comments` instead. Without it the
  app connects fine and then does nothing.
- **Tester invites are accepted on the WEB only:** `https://www.instagram.com/accounts/manage_access/`
  → **Tester Invites** tab. The mobile app does not reliably surface it. The tab only appears
  when an invite is actually pending.
- Webhooks are only delivered when the app is **Live**.

**Meta webhooks — the one that cost us a whole test round**
- **Editing the webhook Callback URL wipes the app's field subscriptions.** After repointing
  the URL at the new domain, `GET /{app-id}/subscriptions` returned `{"data": []}` — a verified
  callback with **zero fields**, so Meta sent nothing and `WebhookEvent` stayed at 0 forever.
  The console shows a reassuring green check either way. Always re-check:

      curl -s "https://graph.facebook.com/v25.0/<APP_ID>/subscriptions?access_token=<APP_ID>|<APP_SECRET>"

  and re-subscribe if empty:

      curl -X POST "https://graph.facebook.com/v25.0/<APP_ID>/subscriptions" \
        -d object=instagram -d callback_url=<URL>/api/webhook \
        -d fields=comments,messages -d verify_token=<TOKEN> \
        -d access_token="<APP_ID>|<APP_SECRET>"

  Note there are **two** independent subscriptions and both must be right: this **app-level**
  one, and the **per-account** one (`/{ig-id}/subscribed_apps`) that the app sets at connect time.

**The poller skips comments the owner already replied to — by design**
- `lib/polling/comment-reconciler.ts` drops any comment that already has a reply from the
  connected account (`ownerReplied`), so a handled comment is never re-touched. Consequence
  while testing: **manually replying to your own test comment permanently disqualifies it.**
  Retest with a *fresh* comment. It is also invisible in the logs — `recordSweep` only writes
  a row when something was enqueued or errored, so "matched but skipped" leaves no trace.

**Domain move 2026-09-17 — `leads-alchemy.online` → `a58lab.com`**
- Done by CLI/API: Vercel domain + `NEXTAUTH_URL`/`EMAIL_FROM` env + redeploy, Namecheap `A openreply -> 76.76.21.21`,
  Railway worker `NEXTAUTH_URL` (redeployed, heartbeat restarted), Meta Basic URLs (#3–5), OAuth redirect (#1, old removed),
  app-level subscription (#2b) re-POSTed and verified against the new domain. Old Vercel alias removed.
- Owner then saved Meta screen #9 with the new callback + verify token. Resend domain `mail.a58lab.com`
  created (Tokyo), records at Namecheap are now **CNAMEs** (`rsend.mail`, `send.mail` -> `*.forge.rmta.net`) plus DKIM TXT —
  Resend no longer asks for the old `MX rsend.mail` record. Resend reports **Verified** (all 3 records green, 2026-09-17 13:26). Old `mail.leads-alchemy.online` domain deleted from Resend.
- **`vercel --prod` from the local checkout shipped the local `.env` into production** (Auth.js then reported
  `Provider with id "resend" not found. Available providers: [nodemailer]` because `.env` sets `EMAIL_SERVER`
  for Mailpit). `.gitignore` alone did not stop the upload. Fixed with a `.vercelignore` (`.env*`, `!.env.example`)
  and a redeploy. Prefer deploying via the GitHub integration; if using the CLI, keep `.vercelignore`.
- The Graph `subscriptions` endpoint takes the **Facebook** app ID (`2901649213548346`) with `FACEBOOK_APP_SECRET`,
  not the Instagram app ID — the Instagram ID returns `Invalid application ID`.

**Railway**
- Start/Build command fields **silently discard input if you press Tab.** Press **Enter**. Our
  first deploy came up "Online" while running `next start` instead of the worker — looked
  perfectly healthy, completely wrong. Always check the deploy log says `> openreply@0.1.0 worker`.
- `DATABASE_PUBLIC_URL` **does not exist** until Settings → Networking → **Add Public Access**.
  Vercel cannot reach Railway's private network.

**Git**
- The original clone was `--depth 20`. Pushing a shallow clone to an empty repo fails with
  *"did not receive expected object"*. Fix: `git fetch --unshallow upstream`.

**Testing**
- The worker **deliberately skips the connected account's own comments** — Meta rejects a private
  reply to yourself. Always test from `abdalrhmanraed`, never `abd_thawabteh`.

---

# 9. What is left to do

Everything infrastructural is **done**. What remains needs a human (OAuth consent) or a live post.

| # | Task | Who |
|---|---|---|
| 1 | **Log in** at `https://openreply.a58lab.com/login` — magic link now arrives by real email via Resend, not Mailpit | owner |
| 2 | **Connect Instagram** — production Postgres is a brand-new database: no account, no campaigns. This is an OAuth consent on the owner's account. | owner |
| 3 | **Rebuild campaigns** there (nothing migrates from local) | owner |
| ~~4~~ | ~~Re-test end to end on the new domain~~ — **done 2026-08-22**, both paths pass, see §4.4 | — |
| 5 | Retire ngrok once #4 passes: stop the tunnel, drop the ngrok OAuth redirect URI from Meta | either |

**Done this session:** Redis public access · Vercel project + env + deploy · DNS A record ·
Resend domain + key + verification · Railway worker already on the final `NEXTAUTH_URL` ·
all five Meta URLs (privacy, terms, data-deletion, OAuth redirect, webhook callback — the
webhook re-verified successfully against the new domain).

### Optional follow-ups
- PR the four bug fixes to `upstream` (`diwenne/openreply`).
- Story **mentions** support.
- "Next story" auto-attach (the repo already has a `pendingNextReel` + cron pattern to copy).
- Facebook Pages / WhatsApp as additional channels (same Meta app).

---

# 10. Useful commands

    # health (local)
    curl -s localhost:3000/api/health | python3 -m json.tool

    # the same four gates CI runs
    npm run typecheck && npm run lint && npm test && npm run build

    # what fired, and why
    docker exec openreplay-postgres-1 psql -U postgres -d openreply -x -c \
      'SELECT "commenterName","commentText","matchedKeyword",status,"errorMessage" FROM "DmLog" ORDER BY "createdAt" DESC LIMIT 10;'

    # poller sweeps / worker errors. Rows are written ONLY when something was
    # enqueued or failed — an empty table means clean sweeps, not a broken worker.
    docker exec openreplay-postgres-1 psql -U postgres -d openreply -tAc \
      'SELECT level, message FROM "OperationalEvent" ORDER BY "createdAt" DESC LIMIT 10;'

    # raw webhook payloads (how we proved reply_to.story exists)
    docker exec openreplay-postgres-1 psql -U postgres -d openreply -tAc \
      'SELECT payload::text FROM "WebhookEvent" ORDER BY "createdAt" DESC LIMIT 1;'

    # production migrations (password lives in Railway → Postgres → Variables)
    DATABASE_URL="postgresql://postgres:<PW>@reseau.proxy.rlwy.net:21321/railway" npm run db:migrate

**Diagnostics UI:** `/diagnostics` shows queue depth, worker heartbeat, webhook failures and DM
failures with reasons. `/logs` shows every send, skip and failure.
