# Broadcast / Bulk SMS Messaging — Implementation Spec

**Status:** 📝 Spec only — not implemented
**Author:** Claude Code (spec pass), August 2026
**Feature:** Send one message to the entire opted-in contact list (station announcements, contest notifications, emergency updates)

This document specs a feature that does not exist in the codebase today. It was previously listed as an unscoped idea in `FEATURE_REQUESTS.md` §8 ("Group/Bulk Messaging"). This spec makes it concrete and implementable.

---

## 1. Overview

Right now the app can only send one SMS at a time, to one recipient, in response to one inbound message (`POST /api/messages/:id/reply`). Station staff have no way to text an announcement to everyone who has opted in. This spec adds a **broadcast** feature: compose one message, confirm a recipient count, and have it delivered to the full opted-in list over time via a background worker — safely, resumably, and with an audit trail.

This is **not** a small feature. At WYXR's list size, a single broadcast will take minutes to tens of minutes to deliver, cannot run inside a single HTTP request, must survive the backend restarting mid-send, and touches Twilio's A2P compliance posture. Each of those constraints shapes the design below.

---

## 2. Verified Current State

Read directly from the repo before writing this spec:

- **`sendSMS(to, message)`** — `server/services/twilio.js:18` — single-recipient primitive, already exported. This is what the broadcast worker calls per-recipient; nothing about it needs to change.
- **Single-recipient reply endpoint** — `POST /api/messages/:id/reply` at `server/routes/messages.js:65`. Its opt-in gate (lines 86–110) is the exact pattern to reuse for broadcast recipient eligibility:
  ```js
  if (contactResult.rows.length === 0) { /* 403: never opted in */ }
  if (!contact.opted_in) { /* 403 */ }
  if (contact.opted_out) { /* 403 */ }
  ```
- **Auth middleware** — `server/middleware/auth.js`:
  - `requireAuth` → returns `401 { error }` JSON (for fetch/AJAX endpoints).
  - `requireAuthAdmin` → redirects to `/admin/login` (for full-page HTML routes).
  Both just check `req.session.authenticated`. **There is no role system** — one shared `AUTH_USERNAME`/`AUTH_PASSWORD` grants full admin access. See §11 and Open Question 7.
- **Admin panel conventions** (`server/routes/admin.js`, 2259 lines):
  - `GET /admin/contacts` (~line 1424) — server-rendered HTML, `requireAuthAdmin`, shows opted-in/pending/opted-out counts via `.stat-card` elements.
  - `POST /admin/contacts/import` (~line 1283) — `requireAuth`, JSON, caps input at 200 rows/request, and already contains a **precedent for a rate-limited outbound SMS loop**:
    ```js
    // server/routes/admin.js:1382-1389
    if (pendingSMSQueue.length > 0) {
      setImmediate(async () => {
        for (const phone of pendingSMSQueue) {
          await twilioService.sendOptInRequest(phone);
          await new Promise(resolve => setTimeout(resolve, 1100));
        }
      });
    }
    ```
    This is fire-and-forget with no persistence of per-recipient outcome, no resumability, and no idempotency — it is the wrong pattern for a real broadcast, but the 1100ms inter-send delay is a proven throughput constant worth reusing (§7.2).
  - `GET/POST/DELETE /admin/blocked-numbers` (~lines 1173–1241) — simple CRUD, `requireAuth`.
  - `GET /admin/messages` (~line 158) — the main server-rendered admin dashboard.
  - Every server-rendered page inlines its own `<style>` block using the brand palette directly (no shared CSS file). New pages should match this (copy `.stat-card`, `.status-badge`, `.nav-link` classes verbatim from the contacts page, ~admin.js lines 1550–1650).
- **Socket.io** — `req.app.get('io')`, then `io.emit(...)`. Events in use today: `message:new`, `message:updated`, `settings:updated`, `contact:updated`. The server-rendered admin HTML pages do **not** currently load `socket.io-client` — they use plain `fetch` and manual refresh/polling (see `GET /admin/messages/search`). This spec follows that precedent (§9) rather than introducing sockets into admin HTML.
- **Schema** (`server/db/schema.sql`): `messages`, `settings`, `session`, `blocked_numbers`, `contacts`, `opt_in_log`. Highest migration file is `server/db/migrations/005_add_contact_source.sql` → this spec is migration **006**.
  - **Important operational detail:** `render-migrate.sh` does not replay individual migration files against production — it re-runs the entire `server/db/schema.sql`, which is written with `CREATE TABLE IF NOT EXISTS` / `ALTER ... ADD COLUMN IF NOT EXISTS` so it's idempotent and cumulative. That means shipping this feature requires **both** a new `006_add_broadcasts.sql` (for anyone tracking migrations file-by-file) **and** appending the same `CREATE TABLE IF NOT EXISTS` statements into `schema.sql` itself, or `render-migrate.sh` will never create the new tables in production.
- **`normalizePhone(raw)`** — `server/utils/phone.js` — converts to E.164, validates `+1[2-9]\d{9}`. Reuse for the test-send phone input.
- **Twilio error handling today** — `server/services/twilio.js:27-34`:
  ```js
  } catch (error) {
    console.error('Error sending SMS:', error);
    // Log A2P errors but don't crash
    if (error.code === 21408 || error.code === 21610) {
      console.warn('A2P approval required - message not sent but logged');
    }
    throw error;
  }
  ```
  That comment is stale — it was written when A2P wasn't approved yet and every send failed. **21408 and 21610 are not "waiting for A2P approval" errors; they're permanent per-recipient failures** (unpermitted region, and carrier-level opt-out, respectively — see §7.3). This spec does not touch `twilio.js`, but flags the comment as misleading for whoever implements this.
- **Keep-alive ping** — `server/server.js:116-131` — in production, if `RENDER_EXTERNAL_URL` is set, the app self-pings `/health` every 10 minutes specifically to defeat Render free-tier spin-down. This *reduces* but does not *eliminate* the spin-down/restart risk this spec designs around: the ping can fail, `RENDER_EXTERNAL_URL` might not be set in every environment, and deploys/crashes restart the process regardless of the keep-alive. The resumable design in §7 is required independent of whether the keep-alive is working.
- **Security hardening landed after the first draft of this spec** (commits `7da61de`…`f587af6`, merged in PRs #6/#7). Three pieces bear directly on this feature:
  - **CSRF origin check** — `server/server.js:73-82`. Every `POST`/`PUT`/`PATCH`/`DELETE` is rejected with `403 { error: 'Cross-site request blocked' }` unless the `Origin` header is present and in `csrfAllowedOrigins`. Only `/api/login` and `/admin/login` are exempt, and `/webhook` is mounted *above* the check. **All five state-changing broadcast routes in §6 are subject to it.** They work unmodified because the admin compose page is served same-origin by this server and browsers send `Origin` on same-origin `fetch` POSTs — but anyone testing these endpoints with `curl` must pass `-H "Origin: http://localhost:3001"` or get a confusing 403. Worth noting in the implementation PR so it isn't debugged twice.
  - **`escapeHtml(text)`** — defined server-side at `server/routes/admin.js:2249` (a second, separate client-side copy exists at line 838 inside a page's `<script>` block). Added to fix stored XSS via unescaped phone values. **This is load-bearing for broadcasts:** `broadcasts.body` is staff-authored free text that gets stored and then rendered back on the status and history pages (§9.2, §9.3). Every interpolation of `body`, `created_by`, `canceled_by`, `error_message`, `last_test_phone`, and any `phone_number` into admin HTML must go through `escapeHtml`, or this feature reintroduces exactly the vulnerability `921567a` just closed. The compose page's `<textarea>` is not exempt — a body containing `</textarea><script>` breaks out otherwise.
  - **Helmet** — `server/server.js:44-46` with **`contentSecurityPolicy: false`**. This is why the admin panel's inline `<style>` blocks and inline `<script>` handlers still work, and it means the compose page's client-side character/segment counter (§9.1) can stay inline, matching existing convention. If CSP is ever switched on, that counter and the existing admin pages break together — not a concern for this spec, but don't "helpfully" enable CSP while implementing it.
- **`settings.messaging_enabled`** (`server/routes/settings.js`) — a global on/off toggle. Today it is **only enforced client-side** (gates the DJ reply UI) — the reply endpoint at `messages.js:65` does not check it server-side. This spec chooses to enforce it server-side for broadcasts (§7.1), since a station-wide "stop messaging" switch should obviously also pause a bulk send — see Open Question 10.

---

## 3. Design Decisions (Already Made)

These are settled; do not re-litigate during implementation.

1. **Lives in the admin panel** (`server/routes/admin.js` conventions — server-rendered HTML, `requireAuth`/`requireAuthAdmin`), not the React DJ dashboard. Contacts, CSV import, and blocked-numbers management already live there; this is staff/traffic-manager territory, not DJ territory, and it needs to work from a phone in the admin's hand, which the admin panel already supports.
2. **Background/queued job, not a synchronous request handler.** Twilio 10DLC long-code throughput is ~1 msg/sec. At ~1,000 recipients that's ~17 minutes — far past any HTTP timeout, and past Render's free-tier idle window. The design must be resumable across process restarts (§7).
3. **Recipient set:**
   ```sql
   SELECT phone_number, first_name, opt_in_method
   FROM contacts c
   WHERE c.opted_in = true
     AND c.opted_out = false
     AND NOT EXISTS (
       SELECT 1 FROM blocked_numbers b WHERE b.phone = c.phone_number
     )
     -- Only listeners who opted in themselves. Excludes contacts whose opt-in was
     -- attested by staff at CSV import rather than performed by the listener.
     -- Unconditional — there is no override. See §8.3.
     AND c.opt_in_method IN ('sms', 'web')
   ```
   This mirrors the reply endpoint's gating logic (§2) plus the blocked-numbers exclusion already used in `messages.js:20-22` and `admin.js`'s contacts query. The `opt_in_method` filter is **additional** to that pattern and specific to broadcasts — a 1:1 DJ reply to someone who texted in is fine regardless of how they were added; a bulk send to someone who never opted in themselves is not (§8.3).

---

## 4. Rejected Alternatives

- **React DJ dashboard UI.** Rejected: broadcast is a staff/management action, not a DJ action; putting a "text everyone" button next to the live on-air message stream invites accidental sends during a show. Keeping it in the separately-authenticated admin panel (same login, different surface) adds a small amount of friction that is appropriate for an irreversible, station-wide action.
- **Synchronous send-in-request-handler.** Rejected outright — see Decision 2. A ~17-minute open HTTP connection isn't viable through Render/Vercel/browsers, and a browser tab close would have no bearing on whether the send continues (bad for a feature that must be resumable).
- **External queue (BullMQ/Redis, SQS, etc.).** Rejected for phase 1: the app has no Redis or message-queue infra today (`server/package.json` has no `bull`/`bullmq`/`agenda`), and this station's volume (low thousands of recipients, roughly one broadcast a week at most) doesn't justify adding new infra and a new failure mode. The Postgres-row-as-queue pattern in §7 gets the same resumability guarantees using infra that already exists. Revisit if broadcast volume or frequency grows enough that DB-polling contention becomes a real cost.

---

## 5. Database Schema

New migration file: **`server/db/migrations/006_add_broadcasts.sql`**

```sql
-- Migration 006: Add broadcasts and broadcast_recipients tables
-- Purpose: Support one-to-many bulk SMS sends (station announcements, contest
--          notifications, emergency updates) to the opted-in contact list.
--          Broadcasts are processed by a background worker (not the request/
--          response cycle) so sends survive process restarts and Render
--          free-tier spin-down. See BROADCAST_MESSAGING_SPEC.md.
-- Created: 2026-08-05

-- Broadcasts table - one row per bulk send (draft, in-flight, or completed)
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,                          -- staff-authored text, WITHOUT the compliance suffix
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, sending, completed, canceled
  created_by VARCHAR(100),                     -- admin session username
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,                    -- when staff clicked Confirm & Send
  started_at TIMESTAMPTZ,                      -- when the worker began processing (== confirmed_at in practice)
  completed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  canceled_by VARCHAR(100),
  recipient_count INTEGER NOT NULL DEFAULT 0,  -- snapshot taken at confirm time
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  character_count INTEGER,                     -- full outgoing text (body + suffix), computed at confirm time
  segment_count INTEGER,
  encoding VARCHAR(10),                         -- 'GSM-7' or 'UCS-2'
  last_test_sent_at TIMESTAMPTZ,
  last_test_phone VARCHAR(20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Broadcast recipients table - one row per (broadcast, phone). This is what
-- makes sends resumable and auditable, and prevents double-texting a listener
-- if the worker restarts mid-broadcast.
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  opt_in_method VARCHAR(20),     -- 'sms' | 'web' | 'import', snapshotted from contacts at
                                 -- confirm time so a complaint months later can be traced to
                                 -- its consent basis even if the contacts row has since changed. See §8.3.
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, sending, sent, failed_permanent, failed_retryable, skipped
  twilio_sid VARCHAR(64),
  error_code VARCHAR(20),
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,        -- set when the worker picks this row up, before calling Twilio
  next_attempt_at TIMESTAMPTZ,   -- retry backoff scheduling
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_id, phone_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_id ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_worker_queue
  ON broadcast_recipients(broadcast_id, status, next_attempt_at);

-- Belt-and-suspenders DB constraint: only one broadcast may be actively
-- sending at a time (the app also enforces this in POST /:id/confirm).
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_one_active
  ON broadcasts ((1))
  WHERE status = 'sending';

-- Reuse existing update_updated_at_column() trigger function from migration 001
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_broadcasts_updated_at'
  ) THEN
    CREATE TRIGGER update_broadcasts_updated_at BEFORE UPDATE ON broadcasts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_broadcast_recipients_updated_at'
  ) THEN
    CREATE TRIGGER update_broadcast_recipients_updated_at BEFORE UPDATE ON broadcast_recipients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;
```

**Remember:** also append the same `CREATE TABLE IF NOT EXISTS` / index / trigger statements to `server/db/schema.sql` (see §2, the `render-migrate.sh` note) or production will never get these tables.

Why a separate `broadcast_recipients` row per recipient, instead of just a JSON array or a counter on `broadcasts`? Three reasons, all load-bearing for the requirements in the prompt:
- **Resumability** — the worker's unit of work is "the next pending row," so a crash mid-broadcast just leaves some rows in `pending`/`sending`; nothing is lost.
- **Idempotency** — the `UNIQUE (broadcast_id, phone_number)` constraint means a given phone number can only ever have one row per broadcast, so recomputing/re-snapshotting the recipient list can't create duplicates, and per-row `status` is the single source of truth for "have we already texted this person for this broadcast."
- **Auditability** — staff can see exactly who got the message, who didn't, and why (`error_code`), which matters for a compliance-sensitive one-to-many send in a way it doesn't for a single DJ reply.

---

## 6. API / Route Surface

New file **`server/routes/broadcasts.js`**, mounted in `server.js` alongside the existing route registrations:
```js
const broadcastsRoutes = require('./routes/broadcasts');
app.use('/admin', broadcastsRoutes);
```
(A new file rather than appending to the already-2259-line `admin.js` — reasonable given the file's current size, but either location works; this is a judgment call, not a hard requirement.)

| Method | Path | Auth | Type | Purpose |
|---|---|---|---|---|
| GET | `/admin/broadcasts` | `requireAuthAdmin` | HTML | History list — past + in-progress broadcasts |
| GET | `/admin/broadcasts/new` | `requireAuthAdmin` | HTML | Compose page |
| GET | `/admin/broadcasts/recipient-count` | `requireAuth` | JSON | Live eligible-recipient count for the compose page preview |
| POST | `/admin/broadcasts` | `requireAuth` | JSON | Create a draft broadcast (validate text, compute segments) |
| PATCH | `/admin/broadcasts/:id` | `requireAuth` | JSON | Edit a draft's body (only while `status = 'draft'`) |
| POST | `/admin/broadcasts/:id/test-send` | `requireAuth` | JSON | Send the exact composed text to one arbitrary phone number |
| POST | `/admin/broadcasts/:id/confirm` | `requireAuth` | JSON | **The irreversible trigger** — snapshot recipients, flip to `sending` |
| GET | `/admin/broadcasts/:id` | `requireAuthAdmin` | HTML | Status/progress page with failure breakdown |
| GET | `/admin/broadcasts/:id/status` | `requireAuth` | JSON | Polling endpoint for the progress bar |
| POST | `/admin/broadcasts/:id/cancel` | `requireAuth` | JSON | Cancel an in-flight broadcast |

### 6.1 `GET /admin/broadcasts/recipient-count`

No parameters — the audience rule is fixed (§3, §8.3).

```json
// Response
{
  "count": 801,              // eligible: opt_in_method IN ('sms','web'), not opted out, not blocked
  "byMethod": {
    "sms": 611,
    "web": 190
  },
  "excludedImported": 41     // opted_in=true but staff-attested at import — never eligible (§8.3)
}
```
Runs the live eligibility query from §3 every time — no caching. Called on compose-page load and again immediately before the Confirm button is enabled, so staff never act on a stale number (see §9.1).

`excludedImported` is reported for transparency only — there is no parameter that includes them. It exists so the compose page can explain why `count` is lower than the contacts page's headline opted-in total, and point staff at the conversion path in §8.3 instead of leaving them to guess.

### 6.2 `POST /admin/broadcasts`
```json
// Request
{ "body": "WYXR is hosting a fundraiser this Saturday at the Cove! Doors at 7pm, free for members." }

// Response
{
  "id": 42,
  "body": "WYXR is hosting a fundraiser this Saturday at the Cove! Doors at 7pm, free for members.",
  "fullText": "WYXR is hosting a fundraiser this Saturday at the Cove! Doors at 7pm, free for members. Reply STOP to opt out.",
  "characterCount": 113,
  "segmentCount": 1,
  "encoding": "GSM-7",
  "status": "draft"
}
```
Server always appends the fixed compliance suffix (`" Reply STOP to opt out."`) to whatever staff types — this is not optional and not staff-editable (§8.1). Validates `body` is non-empty and under `BROADCAST_MAX_CHARACTERS` (env, default 1200 — about 8 GSM-7 segments; see §11 safety rails). Computes `characterCount`/`segmentCount`/`encoding` for the **full** outgoing text (body + suffix).

### 6.3 `PATCH /admin/broadcasts/:id`
Same request/response shape as create. Returns `409 { error: "Cannot edit a broadcast that has already been sent" }` if `status !== 'draft'`.

### 6.4 `POST /admin/broadcasts/:id/test-send`
```json
// Request
{ "phone": "9015551234" }

// Response (success)
{ "success": true, "sentTo": "+19015551234" }
// Response (failure)
{ "success": false, "error": "Invalid phone number format" }
```
Normalizes with `normalizePhone` (`server/utils/phone.js`). Calls `twilioService.sendSMS(phone, fullText)` **directly** — it does not go through `broadcast_recipients` or the worker, and the target number does **not** need to be opted in (staff test with their own phone). Records `last_test_sent_at` / `last_test_phone` on the broadcast row for audit purposes. Not hard-required before Confirm (see Open Question 6) but the compose UI nags for it.

### 6.5 `POST /admin/broadcasts/:id/confirm`
```json
// Request
{ "confirmedRecipientCount": 842 }

// Response (success)
{ "id": 42, "status": "sending", "recipientCount": 839 }

// Response (count drifted)
{ "error": "Recipient count changed since you last checked (was 842, now 795). Please refresh and confirm again." }
// 409

// Response (already active broadcast)
{ "error": "Another broadcast is currently sending. Only one broadcast can be in flight at a time." }
// 409

// Response (cooldown)
{ "error": "A broadcast was sent 12 minutes ago. Wait until the 30-minute cooldown passes, or contact an admin to override." }
// 429
```
Server logic (single transaction):
1. `SELECT * FROM broadcasts WHERE id = $1 AND status = 'draft' FOR UPDATE` — 404/409 if missing or not a draft (guards against double-submit/replay).
2. Safety rails (§11): reject if another broadcast has `status = 'sending'`; reject if inside the cooldown window since the last `confirmed_at`; reject if the live recipient count exceeds `BROADCAST_MAX_RECIPIENTS`; reject if `confirmedRecipientCount` differs from the freshly re-queried live count by more than a small tolerance (catches "I opened this tab an hour ago" staleness).
3. Re-run the §3 eligibility query live (not the number shown on the compose page, which might be stale) and `INSERT INTO broadcast_recipients (broadcast_id, phone_number) SELECT $1, phone_number FROM (...) ON CONFLICT DO NOTHING`.
4. `UPDATE broadcasts SET status='sending', confirmed_at=NOW(), started_at=NOW(), recipient_count=(SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id=$1), created_by=$2 WHERE id=$1 AND status='draft' RETURNING *`. The `AND status='draft'` makes this UPDATE itself the atomic guard against a race between two simultaneous confirm clicks — whichever transaction commits first wins; the second's `WHERE` clause no longer matches.
5. Commit. No explicit "start the worker" call is needed — the worker's tick loop (§7.1) is always running and just polls for `status = 'sending'`.

### 6.6 `GET /admin/broadcasts/:id/status`
```json
{
  "status": "sending",
  "recipientCount": 839,
  "sentCount": 214,
  "failedCount": 3,
  "skippedCount": 0,
  "pendingCount": 622,
  "startedAt": "2026-08-05T18:02:11.000Z",
  "estimatedCompletionAt": "2026-08-05T18:13:53.000Z"
}
```
`estimatedCompletionAt` = `now + pendingCount * SEND_INTERVAL_MS`. Polled every 3–5s by the status page while `status === 'sending'`; polling stops client-side once status is terminal (`completed`/`canceled`).

### 6.7 `POST /admin/broadcasts/:id/cancel`
```json
{ "id": 42, "status": "canceled", "sentCount": 214, "skippedCount": 625 }
```
`UPDATE broadcasts SET status='canceled', canceled_at=NOW(), canceled_by=$user WHERE id=$1 AND status='sending'` (404/409 otherwise), then bulk `UPDATE broadcast_recipients SET status='skipped' WHERE broadcast_id=$1 AND status IN ('pending','failed_retryable')`. Rows already claimed (`status='sending'`) at the moment of cancel are left to finish naturally — the Twilio call may already be in flight — the worker just won't start any new ones once it observes `status='canceled'`.

---

## 7. The Send Worker

### 7.1 Driving loop

No queue infra exists in this codebase (§4). The worker is a single always-on `setTimeout`-recursive loop (not `setInterval`, to avoid overlapping ticks if a query is slow), started once from `server.js` next to the other route/service wiring:

```js
// server/services/broadcastWorker.js
const SEND_INTERVAL_MS = parseInt(process.env.BROADCAST_SEND_INTERVAL_MS || '1100', 10);

async function tick() {
  try {
    const { rows: [broadcast] } = await pool.query(
      `SELECT * FROM broadcasts WHERE status = 'sending' ORDER BY started_at LIMIT 1`
    );

    if (broadcast) {
      const messagingEnabled = await isMessagingEnabled(); // reads settings.messaging_enabled
      if (messagingEnabled) {
        await sendNextRecipient(broadcast);
      }
      // else: no-op this tick, effectively auto-pausing the broadcast — see §2
    }
  } catch (err) {
    console.error('[broadcast-worker] tick error:', err);
  } finally {
    setTimeout(tick, SEND_INTERVAL_MS);
  }
}

function start() {
  resumeInterruptedBroadcasts().finally(() => tick());
}

module.exports = { start };
```

```js
async function sendNextRecipient(broadcast) {
  const { rows: [recipient] } = await pool.query(
    `UPDATE broadcast_recipients
     SET status = 'sending', claimed_at = NOW(), attempt_count = attempt_count + 1
     WHERE id = (
       SELECT id FROM broadcast_recipients
       WHERE broadcast_id = $1
         AND status = 'pending'
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [broadcast.id]
  );

  if (!recipient) {
    const { rows: [{ pending }] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) AS pending
       FROM broadcast_recipients WHERE broadcast_id = $1`,
      [broadcast.id]
    );
    if (parseInt(pending, 10) === 0 && broadcast.status === 'sending') {
      await pool.query(
        `UPDATE broadcasts SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [broadcast.id]
      );
    }
    return;
  }

  try {
    const result = await twilioService.sendSMS(recipient.phone_number, fullTextFor(broadcast));
    await pool.query(
      `UPDATE broadcast_recipients SET status = 'sent', twilio_sid = $1, sent_at = NOW() WHERE id = $2`,
      [result.sid, recipient.id]
    );
    await pool.query(`UPDATE broadcasts SET sent_count = sent_count + 1 WHERE id = $1`, [broadcast.id]);
  } catch (error) {
    await handleSendError(broadcast, recipient, error);
  }
}
```

`FOR UPDATE SKIP LOCKED` is defensive in case this ever runs on more than one instance — Render's free tier runs a single instance, so in practice there's no real concurrency today, but it costs nothing to make the claim query safe for that case.

### 7.2 Rate limiting

`SEND_INTERVAL_MS` defaults to **1100ms**, matching the proven constant already used in the CSV-import opt-in queue (`admin.js:1386`) for the same reason: Twilio's 10DLC long-code throughput ceiling is ~1 msg/sec, and 1100ms leaves headroom. One recipient is sent per tick — no batching multiple Twilio calls per tick, since there's no throughput benefit to it (Twilio is the bottleneck, not the DB). Configurable via env var if the station's registered throughput changes (e.g. after a campaign upgrade).

### 7.3 Retry policy: transient vs. permanent errors

```js
// Twilio error codes that mean "this number will never work" — no retry
const PERMANENT_ERROR_CODES = new Set([
  21610, // Recipient has opted out at the carrier/Advanced Opt-Out level
  21614, // 'To' number is not a valid mobile number
  21211, // Invalid 'To' phone number
  21408, // Region/country not enabled for this account (unpermitted region)
  21618, // 'To' number is not currently reachable (permanently, per Twilio's own docs for this code)
]);

async function handleSendError(broadcast, recipient, error) {
  const code = error.code;

  if (code === 21610) {
    // Twilio's own Advanced Opt-Out handling can intercept a STOP reply before it
    // ever reaches our /webhook/sms — meaning contacts.opted_out can silently drift
    // out of sync with what Twilio itself already knows. Self-heal on discovery.
    await pool.query(
      `UPDATE contacts SET opted_out = true, opted_out_timestamp = NOW() WHERE phone_number = $1`,
      [recipient.phone_number]
    );
  }

  if (PERMANENT_ERROR_CODES.has(code)) {
    await markFailed(broadcast, recipient, 'failed_permanent', code, error.message);
    return;
  }

  // Transient (network errors, 20429 Twilio-side rate limit, 30001-30006 carrier
  // hiccups, etc.) — retry with backoff, max 3 attempts total
  if (recipient.attempt_count >= 3) {
    await markFailed(broadcast, recipient, 'failed_permanent', code, `Max retries exceeded: ${error.message}`);
    return;
  }

  const backoffSeconds = 30 * Math.pow(2, recipient.attempt_count - 1); // 30s, 60s, 120s
  await pool.query(
    `UPDATE broadcast_recipients
     SET status = 'pending', error_code = $1, error_message = $2,
         next_attempt_at = NOW() + ($3 || ' seconds')::interval
     WHERE id = $4`,
    [String(code || 'unknown'), error.message, backoffSeconds, recipient.id]
  );
}

async function markFailed(broadcast, recipient, status, code, message) {
  await pool.query(
    `UPDATE broadcast_recipients SET status = $1, error_code = $2, error_message = $3 WHERE id = $4`,
    [status, String(code || 'unknown'), message, recipient.id]
  );
  await pool.query(`UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = $1`, [broadcast.id]);
}
```

This directly builds on the two codes `twilio.js:30` already special-cases (21408, 21610) — but treats them correctly as **permanent, per-recipient** failures rather than "not approved yet." The status page (§9.2) shows a human-readable breakdown grouped by `error_code` (e.g. "21610 — opted out at carrier level (4)").

### 7.4 Idempotency (never double-text someone on a resume)

Two layers:

1. **Primary — the state machine.** `broadcast_recipients` has a `UNIQUE (broadcast_id, phone_number)` row per recipient, and the claim query in §7.1 only ever picks rows with `status = 'pending'`, immediately flipping them to `'sending'` in the same atomic `UPDATE ... RETURNING`. A given row can only be claimed once per tick; once it's `'sent'` or `'failed_permanent'`, no future tick will touch it again. This is what guarantees a resumed job (§7.5) never re-sends to someone already marked `sent`.
2. **Belt-and-suspenders — Twilio reconciliation on restart.** The one gap the state machine alone can't close: if the process is killed in the tiny window *after* `twilioService.sendSMS()` has already succeeded at Twilio but *before* the `UPDATE ... SET status = 'sent'` commits, that row is stuck at `status = 'sending'` even though the text actually went out. §7.5 covers the recovery for exactly this case.

### 7.5 Crash / spin-down recovery

Called once at process boot, from `server.js`, before the tick loop starts:

```js
async function resumeInterruptedBroadcasts() {
  // Rows claimed by a worker tick that never got to record an outcome (crash,
  // spin-down, deploy) are stuck at status='sending'. Give any truly in-flight
  // Twilio call a couple minutes to either land or fail, then reconcile.
  const { rows: stuck } = await pool.query(
    `SELECT r.*, b.started_at, b.body
     FROM broadcast_recipients r
     JOIN broadcasts b ON b.id = r.broadcast_id
     WHERE r.status = 'sending' AND r.claimed_at < NOW() - INTERVAL '2 minutes'`
  );

  for (const row of stuck) {
    // Ask Twilio directly whether a message to this number actually went out
    // after this broadcast started, rather than trusting our own DB state —
    // this is the check that prevents a double-text after a crash.
    const recent = await twilioClient.messages.list({
      to: row.phone_number,
      from: process.env.TWILIO_PHONE_NUMBER,
      dateSentAfter: row.started_at,
      limit: 5
    });
    const alreadySent = recent.find(m => m.body === fullTextFor({ body: row.body }));

    if (alreadySent) {
      await pool.query(
        `UPDATE broadcast_recipients SET status = 'sent', twilio_sid = $1, sent_at = $2 WHERE id = $3`,
        [alreadySent.sid, alreadySent.dateSent, row.id]
      );
    } else {
      await pool.query(
        `UPDATE broadcast_recipients SET status = 'pending', claimed_at = NULL WHERE id = $1`,
        [row.id]
      );
    }
  }
}
```

This runs regardless of *why* the process restarted — Render spin-down, a deploy, an uncaught exception, a manual restart — so no special-casing of "was this Render specifically" is needed. Combined with the always-on tick loop (which just polls for `status = 'sending'` broadcasts and doesn't care whether it's the same process that started them), a broadcast started at 6:00pm that gets interrupted by a spin-down at 6:05pm will simply resume from wherever it left off the next time the process boots (which, per §2, happens either from the keep-alive ping or the next incoming request/webhook).

---

## 8. Compliance

### 8.1 Opt-out language

Existing message templates (`server/services/twilio.js:9-16`) are the tone/format precedent — every single one carries STOP language:
```
OPT_IN_CONFIRMATION: "WYXR 91.7 FM: Welcome! You're now connected with our DJs. Text song requests anytime during live shows. Reply STOP to opt out. Msg&data rates may apply. Privacy: wyxr.org/privacy-policy/"
OPT_OUT_CONFIRMATION: "WYXR 91.7 FM: You're unsubscribed. No more messages will be sent. You can still listen at wyxr.org! Reply START to rejoin anytime."
```
Broadcast bodies follow the same rule, enforced server-side rather than left to staff memory: whatever staff types in the compose textarea gets a fixed suffix appended automatically before sending —
```
" Reply STOP to opt out."
```
— every time, with no way to omit it from the compose UI. The full outgoing text (`body + suffix`) is what gets segment-counted, test-sent, and delivered. Staff should still open with "WYXR 91.7 FM:" by convention (matching every existing template) but that part is free text, not enforced.

### 8.2 Consent scope — what the published policies authorize

The station's **published, consumer-facing disclosures do cover broadcast-style sending.** This is the controlling language, from wyxr.org Terms & Conditions (Effective Jan 1 2026, last updated Feb 6 2026):

**§5.8 — the disclosed program description:**
> Program name: WYXR 91.7 FM SMS
> **Message types: DJ/listener interaction, event alerts, community updates**
> Message frequency: Varies based on programming schedule

**§5.1 — Program Description:**
> By texting WYXR's number, you consent to receive text messages from WYXR, including responses from DJs, **station updates, and occasional promotional messages.**

**SMS Privacy Policy:**
> we collect your mobile phone number and first name solely to send you messages related to **WYXR programming, show updates, and DJ interactions**

"Event alerts," "community updates," "station updates," and "occasional promotional messages" are exactly the broadcast use cases in §1 (announcements, contest notifications, emergency station updates). The disclosures also already carry every element a broadcast needs: STOP opt-out (§5.3), HELP support (§5.7), "msg & data rates may apply" (§5.4), and variable message frequency. **The consent scope question is resolved — broadcasts are within what listeners were told they were signing up for.** No policy rewrite is a prerequisite for phase 1.

**(a) The TCR campaign registration also covers broadcasts — verified.** Carrier filtering keys off the use case, sample messages, and message-flow description submitted to The Campaign Registry, not off the station's website terms, so this needed separate confirmation. It has been checked in the Twilio Console (campaign status: **Verified**, US, A2P 10DLC):

- **Campaign use case: `MIXED`** — not Conversational-only. Mixed explicitly covers both two-way conversational traffic and one-to-many informational/promotional sends, which is exactly this feature's traffic pattern. This was the single largest risk in the original draft of this spec and it is now closed.
- **The registered campaign description enumerates broadcast content directly:** *"We also send **program updates, event announcements, and community alerts** to keep our audience informed about station activities."* The registration and the published T&C (§5.8) therefore say the same thing, which is the ideal position — the traffic the station intends to send is described identically in both the consumer-facing disclosure and the carrier-facing registration.
- **The registered opt-in methods are exactly the two this spec treats as valid**, which independently corroborates the audience rule in §8.3: *"(1) Text-to-Opt-In – listeners text the keyword JOIN to 901-460-3031 … They receive an automated opt-in confirmation message and must reply YES to confirm (double opt-in). (2) Web Form – visitors to wyxr.org/text enter their first name and mobile number, then check an unchecked SMS consent checkbox…"* Staff CSV attestation appears **nowhere** in the registered consent flow. So excluding `opt_in_method = 'import'` from broadcasts isn't just conservatism on this spec's part — it's what the station told the carriers its consent process is. Sending broadcasts to attested-only contacts would be a discrepancy between registered and actual practice.
- **Embedded links: Yes** (registered and permitted). Practical implication for the compose page: keep links on `wyxr.org`. Public URL shorteners (`bit.ly`, `tinyurl`, etc.) are a well-known A2P carrier-filtering trigger regardless of campaign registration, because they obscure the destination. A cheap addition to the compose page's validation is a soft warning when the body contains a known shortener domain — not a hard block, since staff may have a legitimate reason.

Two smaller registration-hygiene notes, neither blocking:

- **Both registered sample messages are conversational** — Sample #1 is the `OPT_IN_CONFIRMATION` template verbatim, Sample #2 is a DJ song-request reply. Neither shows an announcement-style message, even though the description covers announcements and the use case is `MIXED`. Samples are meant to be representative of actual traffic, so adding a third sample resembling a real broadcast (e.g. *"WYXR 91.7 FM: Our fall membership drive kicks off Monday — tune in all week for special programming. Reply STOP to opt out."*) would tighten the registration. Optional; the `MIXED` use case plus the explicit description is what actually authorizes the traffic.
- **The `JOIN` keyword is not special-cased in code.** `isYesKeyword` (`server/routes/webhook.js:19-22`) matches `yes/y/confirm/ok/sure/start` — not `join`. This is **not** a compliance gap: an inbound `JOIN` from an unknown number falls through to the new-contact path, which creates a pending contact and auto-sends `OPT_IN_REQUEST`, and the listener then replies YES. That is precisely the double opt-in the registration describes, so registered and actual behavior match. The only wrinkle is cosmetic — a literal `JOIN` gets stored as `pending_message` and forwarded to DJs after confirmation, which is noise rather than a real listener message. Worth suppressing someday; out of scope here.

**(b) Fundraising remains the one uncovered case — now confirmed in two places.** The privacy policy's "**solely** … programming, show updates, and DJ interactions" is narrower than the T&C's "occasional promotional messages." A pledge-drive or donation-ask text — a predictable want for a 501(c)(3) — sits in the gap between those two sentences. Programming/event/community announcements are clearly fine; donation solicitation is not clearly authorized by the narrower privacy-policy sentence.

The TCR registration points the same way: its description covers *"program updates, event announcements, and community alerts to keep our audience informed about station activities"* and says nothing about fundraising or donations either — despite the description opening by identifying WYXR as a 501(c)(3) nonprofit. So the gap is consistent across both documents rather than being an artifact of one sentence's wording.

If the station wants to text donation asks, update the privacy-policy sentence **and** add fundraising language to the campaign description (the latter is an edit to a Verified campaign, so allow time for re-review). Flagged as Open Question 3, and deliberately *not* something the code should try to police — a keyword filter for "donate" would be trivially evadable and would give false assurance.

### 8.3 ⚠️ Imported contacts have a weaker consent basis than the policies describe

This is the real compliance gap the published terms expose, and it is a **code-level** concern rather than a policy one.

The T&C describe consent as arising from the listener's own action — §5.2: "**By sending a text message to WYXR's phone number**, you expressly consent…" — and the web form provides a second documented path. The schema records which path each contact took, in `contacts.opt_in_method` (`server/db/schema.sql:47`), and only three values are ever written:

| `opt_in_method` | Written at | Consent basis |
|---|---|---|
| `'sms'` | `server/routes/webhook.js:186` | Listener texted in and replied YES. Matches T&C §5.2 exactly. Strongest. |
| `'web'` | `server/routes/web-opt-in.js:62,95` | Listener submitted the opt-in form; `opt_in_log` captures `consent_text`, `ip_address`, `source_url`. Strong. |
| `'import'` | `server/routes/admin.js:1314,1361` | **Admin attested prior consent during CSV import.** `opted_in` is set to `true` immediately when the request passes `consented: true`, and `opt_in_log` records only `'Admin attested prior consent via CSV import (source: …)'`. |

That third row is the problem. An `'import'` contact never performed any documented consumer action — no inbound text, no form submission, no captured consent text or IP. The audit trail proves *a staff member asserted* consent, not that the listener gave it. These contacts are nonetheless `opted_in = true` and would therefore be swept into the §3 eligibility query alongside everyone else.

For 1:1 DJ replies this matters little (the listener texted first in practice). For a one-to-many broadcast it matters a lot: unconsented recipients in a bulk send are the classic TCPA exposure, and they're also the likeliest source of spam complaints, which is what triggers carrier filtering in the first place.

**Spec decision (settled — station direction is that only opted-in listeners receive broadcasts):** `opt_in_method = 'import'` contacts are excluded from broadcasts **unconditionally**. There is no override checkbox, no env var, and no `include_imported` column. The eligibility query in §3 hard-codes:

```sql
AND c.opt_in_method IN ('sms', 'web')
```

An earlier draft of this spec made the exclusion a *default* with a staff override. That was the wrong shape: an override checkbox invites exactly the judgment call that shouldn't be made under time pressure during an emergency broadcast, and "the flag says `opted_in = true`" is precisely the reasoning the exclusion exists to prevent.

**The remedy is conversion, not an override — and the code already implements it.** Imported contacts have a documented path to becoming genuinely broadcast-eligible, with no new code required:

1. Import the CSV **without** the consent attestation (omit `consented`, or send it falsy). `server/routes/admin.js:1326-1337` then inserts the contact with `opted_in = false`, `opt_in_method = 'import'`, logs `import_opt_in_request` to `opt_in_log`, and queues the standard `OPT_IN_REQUEST` SMS ("…Reply YES to confirm…") through the same rate-limited loop at `admin.js:1382-1389`.
2. When the listener replies YES, `server/routes/webhook.js:181-191` sets `opted_in = true` **and rewrites `opt_in_method` to `'sms'`**, sends the confirmation, and writes a `confirm` row to `opt_in_log`.
3. That contact now satisfies `opt_in_method IN ('sms', 'web')` and is picked up by the next broadcast automatically.

So the correct operational answer for staff who want imported listeners included is *ask them* — re-import without the attestation and let them confirm. That converts an attestation into real, logged, listener-performed consent. The only contacts permanently outside the broadcast audience are those who were attested-for and never confirmed, which is the intended outcome.

Two supporting requirements remain:

- `GET /admin/broadcasts/recipient-count` (§6.1) returns the eligible count **broken down by `opt_in_method`**, including the excluded `import` figure. This is for transparency, not for choice — staff should be able to see "41 imported contacts are not receiving this" and know the conversion path exists, rather than silently wondering why the count is lower than the contacts page's opted-in total.
- `broadcast_recipients` stores each recipient's `opt_in_method` at send time (§5), so a complaint months later can be traced to its consent basis without relying on the live `contacts` row, which may have changed since.

**Follow-on worth considering (not in this spec's scope):** the `consented: true` import branch (`admin.js:1314`, `admin.js:1361`) sets `opted_in = true` on a staff attestation alone, which is now a flag that grants less than it appears to — it admits a contact to DJ replies but not to broadcasts. That's a defensible split, but it makes `opted_in` mean two different things depending on `opt_in_method`. A cleaner future model would drop the attestation branch entirely and route every import through the confirmation flow. Flagged for `FEATURE_REQUESTS.md`, not changed here.

### 8.4 Character count / segment guidance

Standard SMS segmenting rules:
- **GSM-7 encoding** (the default character set — letters, digits, common punctuation): **160 characters** for a single-segment message, but **153 characters per segment** once a message needs to be split across multiple segments (concatenation overhead eats 7 chars/segment).
- **UCS-2 encoding** (triggered by *any* character outside the GSM-7 alphabet — emoji, curly “smart” quotes, em dashes, non-Latin scripts): **70 characters** single-segment, **67 characters per segment** when concatenated.
- A handful of GSM-7 "extended" characters (`^ { } \ [ ~ ] | €`) each consume **2 characters** of budget even though they display as one, because they require an escape sequence in GSM-7.

Since Twilio bills **per segment per recipient** (§10), the auto-appended `" Reply STOP to opt out."` suffix (23 characters) is not free — it can be the difference between a 1-segment and a 2-segment send across the whole list. The compose page's live counter (§9.1) must count the **full text including the suffix**, and should visibly warn when staff are close to a segment boundary. Detecting GSM-7 vs. UCS-2 requires checking every character against the GSM 03.38 basic + extension character set; either hand-roll that check or use a small existing utility — there's no such dependency in `server/package.json` today, so this is a net-new (tiny) addition either way.

---

## 9. Admin UI

All server-rendered HTML, matching the existing admin panel's inline-`<style>`-block convention (no shared CSS file, no build step) and brand palette: **`#FFC629`** yellow (headers/titles), **`#E9407A`** pink (accent/alert — used here for the destructive "Send"/"Cancel" actions, mirroring how pink already marks the unread indicator elsewhere in the app), **`#2B9EB3`** blue (routine actions/links — "Preview," "Test Send"), **`#2B2B2B`** dark background.

### 9.1 Compose page — `GET /admin/broadcasts/new`

- Textarea for the message body (the free-text part only — the STOP suffix is shown below it, read-only, "This will be added automatically: *Reply STOP to opt out.*").
- Live character/segment counter (client-side JS, mirrors §8.4 math) showing e.g. `113 / 160 characters · 1 segment (GSM-7)`, turning to a warning color when adding more text would push into a second segment.
- **"Preview recipient count"** button → calls `GET /admin/broadcasts/recipient-count`, displays the number prominently (large `.stat-card`-style number, `#FFC629` on dark, matching the contacts page's stat cards).
- **Consent-basis breakdown**, rendered beneath the headline count as two smaller stat cards (`Texted in: 611 · Web form: 190`), so staff can see the composition of the audience rather than one opaque total.
  - Below that, when `excludedImported > 0`, a muted informational line (no checkbox, nothing clickable): *"41 imported contacts are not included. Their opt-in was attested by staff at import rather than confirmed by the listener. To include them, re-import without the consent attestation so they receive a confirmation text."* — links to §8.3's conversion path in the admin docs.
  - This is deliberately **not** a control. The audience rule is fixed; the line exists so the number reconciles against the contacts page and staff aren't left thinking the count is a bug. See §8.3.
- **URL shortener soft warning.** If the body matches a known shortener domain (`bit.ly`, `tinyurl.com`, `t.co`, `goo.gl`, `ow.ly`, `is.gd`, `buff.ly`, `rebrand.ly`), show an inline caution: *"Shortened links are a common cause of carrier filtering. Use a full wyxr.org link if you can."* Non-blocking — staff may have a valid reason. The campaign is registered for embedded links (§8.2a), so links themselves are fine; opaque ones are the risk.
- **"Send test message"** input (phone number) + button → calls `POST /admin/broadcasts/:id/test-send`. Strongly recommended in copy ("Send yourself a test before broadcasting to everyone") but not hard-blocking (Open Question 6).
- **Confirm & Send** section, visually separated (bordered box, pink `#E9407A` border) to signal "this is different from every other button on this page":
  - Re-fetches the live recipient count immediately before enabling the button (never trusts a count fetched more than a few seconds ago).
  - Requires typing the displayed recipient count or a literal confirmation phrase (e.g. `SEND TO 842`) into a text input before the Send button un-disables — a lightweight guard against a mis-click given there's no per-user access control distinguishing who's allowed to trigger this (§2, §11, Open Question 7).
  - Button label reads **"Send to {count} recipients — this cannot be undone."**
  - On click → `POST /admin/broadcasts/:id/confirm`, then redirect to the status page.

### 9.2 Status/progress page — `GET /admin/broadcasts/:id`

- Stat cards reusing the exact `.stat-card` CSS from the contacts page (`#2B9EB3` border, `#FFC629` numbers): **Sent**, **Failed**, **Skipped**, **Remaining**.
- A simple progress bar (`sent_count / recipient_count`), with `estimatedCompletionAt` from the status endpoint shown as "~7 minutes remaining."
- **Cancel** button (pink, styled as a warning action), visible only while `status === 'sending'`; confirms via a plain `confirm()` JS dialog before calling `POST /admin/broadcasts/:id/cancel`.
- Failure breakdown table, grouped by `error_code`, with a human-readable label map (`21610` → "Opted out at carrier level," `21408` → "Unsupported region," `21614`/`21211` → "Invalid number," anything else → "Delivery error").
- Auto-refreshes via `fetch('/admin/broadcasts/:id/status')` every 3–5 seconds while `status === 'sending'`; stops polling once the status is terminal.

### 9.3 History page — `GET /admin/broadcasts`

- Table: date, body preview (truncated), status badge (reusing `.status-badge` styling — green/yellow/red/gray for completed/sending/failed/canceled), recipient count, sent/failed counts, "View" link to the status page.
- **"New Broadcast"** button (blue `#2B9EB3`, top of page) → compose page.

---

## 10. Cost Estimate

Twilio's public US long-code SMS pricing (checked August 2026): outbound is roughly **$0.0079–$0.0083 per segment**, plus a carrier fee of roughly **$0.003–$0.005 per message** on top (carrier fees vary by destination carrier and are billed separately from the base per-segment rate). This is a planning estimate from public pricing pages, **not an account-specific quote** — confirm the station's actual current negotiated/list rate in the Twilio Console before publishing a budget number to station leadership (see Open Question 8).

Formula:
```
cost ≈ recipient_count × segment_count × (base_rate_per_segment + carrier_fee_per_message)
```

Worked examples at a blended planning rate of **~$0.012/segment all-in** (base + carrier fee):

| Recipients | Segments | Estimated cost |
|---|---|---|
| 500 | 1 | ~$6.00 |
| 500 | 2 | ~$12.00 |
| 1,000 | 1 | ~$12.00 |
| 1,000 | 2 | ~$24.00 |
| 2,500 | 1 | ~$30.00 |
| 2,500 | 2 | ~$60.00 |

Every broadcast is cheap in absolute terms even at the low thousands of recipients — but the segment count matters more than it looks, since the auto-appended STOP suffix (§8.4) can silently push a message from 1 segment to 2, doubling the per-recipient cost. The compose page's live segment counter (§9.1) exists specifically so staff see this before confirming, not after the bill arrives.

Sources: [Twilio SMS API cost: complete pricing breakdown for 2026](https://apidog.com/blog/twilio-sms-api-cost/), [Twilio Pricing 2026: The Real Monthly Cost](https://textbee.dev/blog/twilio-pricing-real-cost-breakdown), [Twilio Pricing | Twilio](https://www.twilio.com/en-us/pricing)

---

## 11. Safety Rails

- **Max recipients guard.** `BROADCAST_MAX_RECIPIENTS` env var (default: TBD — see Open Question 5, the actual current opted-in count wasn't available to check from this environment). `POST /:id/confirm` rejects with `409` if the live eligible count exceeds this. Intentionally requires an explicit env change to raise, not a UI toggle — makes "send to way more people than expected" a deliberate act.
- **Send-frequency cooldown.** `BROADCAST_MIN_INTERVAL_MINUTES` env var (default: 30). `POST /:id/confirm` rejects with `429` if another broadcast was `confirmed_at` within that window. Guards against double-firing (two tabs, a fat-fingered second click) more than it enforces an actual business policy — there's no hard requirement from the station on broadcast frequency, so this is a deliberately conservative default, tunable.
- **Dry-run / test-send.** `POST /:id/test-send` (§6.4) sends the exact composed text, including the STOP suffix, to one arbitrary number outside the recipient pipeline. Strongly recommended in the UI, not server-enforced (Open Question 6) so a genuine emergency broadcast isn't blocked on it.
- **Who can trigger it.** Whoever has the shared `AUTH_USERNAME`/`AUTH_PASSWORD` login (§2 — there is no role system in this app today). This spec does not add a new auth model; it mitigates the risk at the UI layer only, via the typed-confirmation guard in §9.1. Flagged explicitly as Open Question 7 — a real access-control answer (e.g., a second credential, or requiring two people) is a business decision, not something this spec can resolve on its own.
- **`messaging_enabled` kill switch.** The worker checks `settings.messaging_enabled` before every send (§7.1) and no-ops (effectively auto-pausing) while it's off — a broadcast that's mid-flight when staff hit the existing "pause all messaging" toggle stops immediately rather than continuing to blast the list. This is new server-side enforcement of a setting that today only gates the DJ reply UI client-side (§2) — confirmed as the desired behavior in Open Question 10, since it changes that toggle's blast radius.

---

## 12. Testing Plan

Testing this without texting the real 800+-person list:

1. **Unit-level:** segment/character counter (§8.4) against known GSM-7/UCS-2 boundary cases (159/160/161 chars; a message with one emoji; a message with a curly “smart” quote pasted from a Word doc — a very likely real-world staff mistake).
2. **Local/dev DB, fake contacts:** seed a local Postgres with a `contacts` table containing 10–20 rows using real personal test phone numbers (station staff's own phones) with `opted_in = true`, plus a couple of `opted_out = true` and `blocked_numbers` rows, to verify the eligibility query (§3) excludes them correctly. **Never point a broadcast at the production DB during development.**
3. **Twilio test credentials:** Twilio provides [test credentials and magic phone numbers](https://www.twilio.com/docs/iam/test-credentials) that simulate specific error codes (including 21610 and 21408) without sending real SMS or incurring cost — use these to exercise the retry/permanent-failure classification (§7.3) end-to-end without touching real numbers.
4. **Small real send:** before the first real broadcast, run one against a `contacts` filter limited to 3–5 staff phone numbers only (temporarily, via a one-off `WHERE phone_number IN (...)` override, not the real eligibility query) to verify the full path — compose, confirm, worker delivery, status page, Twilio SIDs recorded — against real Twilio infrastructure at negligible cost/risk.
5. **Crash-recovery test:** start a broadcast against the staff-only test list, `kill -9` (or `SIGTERM`) the dev server process mid-send after 1–2 recipients have gone out, restart it, and confirm via `broadcast_recipients` that (a) the interrupted send is reconciled correctly by `resumeInterruptedBroadcasts` (§7.5), (b) no one receives a duplicate text, and (c) the remaining recipients still get sent.
6. **Cancel test:** start a broadcast against the staff-only list, cancel it after 1 recipient, confirm remaining rows flip to `skipped` and the worker doesn't process any more for that broadcast.
7. **Consent-filter test:** seed local contacts with a mix of `opt_in_method` values (`'sms'`, `'web'`, `'import'` — the last with `opted_in = true`, i.e. the staff-attested case) and confirm that `GET /admin/broadcasts/recipient-count` reports the correct `byMethod` breakdown, that `import` rows appear only in `excludedImported`, and that **no** request parameter or payload can pull them into an actual send. Then exercise the conversion path end-to-end: import a row without the attestation, simulate a `YES` reply to the webhook, assert `opt_in_method` flips to `'sms'` (`webhook.js:181-191`), and confirm the contact now appears in the eligible count (§8.3).
8. **XSS regression test:** compose a broadcast whose body is `</textarea><script>alert(1)</script>` plus a `"><img src=x onerror=alert(1)>` variant, save it, and load the compose, status, and history pages. Nothing should execute and the raw text should render visibly as typed. This is a direct regression guard on `921567a` (§2) — staff-authored body text is the widest new injection surface this feature adds.
9. **CSRF smoke test:** confirm each §6 state-changing route returns `403 { error: 'Cross-site request blocked' }` with no `Origin` header and succeeds with a valid one (§2), so the check is verified as active rather than accidentally bypassed by route-mount order.
10. **Full send:** only after 1–9 pass. The A2P/TCR prerequisite is already satisfied — the campaign is Verified with a `MIXED` use case covering announcements (§8.2a) — so there is no outstanding compliance gate on the first real broadcast, provided the message is programming/event/community content rather than a fundraising ask (§8.2b).

---

## 13. Phased Rollout

**Phase 1 (this spec):**
- Migration 006 (+ `schema.sql` update)
- All routes in §6
- Worker with rate limiting, retry classification, idempotency, and crash recovery (§7)
- Compose, status, and history admin pages (§9)
- Compliance suffix auto-append, live segment/character counter (§8.1, §8.4)
- `escapeHtml` on every staff-authored and contact-derived value rendered into the new admin pages (§2 — non-negotiable, this is a known-closed XSS class)
- Consent-basis handling: `opt_in_method IN ('sms','web')` enforced in the eligibility query, per-method recipient breakdown, `opt_in_method` snapshotted per recipient (§8.3)
- Safety rails: max recipients, cooldown, confirm-count re-check, typed-confirmation guard, `messaging_enabled` integration (§11)

**Deferred (phase 2+):**
- Audience segmentation beyond "everyone opted in" (e.g., by `contacts.source`, or a saved-tag/list system)
- Scheduling a broadcast for a future send time (currently: confirm = send now)
- Live Socket.io progress push to the status page (vs. HTTP polling) and multi-tab sync for staff watching the same in-flight broadcast from different devices
- CSV export of the per-recipient failure detail
- Role-based access control distinguishing "can send broadcasts" from general admin login (Open Question 7)
- MMS/rich content support
- Adding an announcement-style third sample message to the TCR campaign registration, and fundraising language if the station decides to text donation asks (§8.2a/b) — registration hygiene, not code
- Suppressing a literal `JOIN` from being forwarded to DJs as a message (§8.2a)

---

## 14. Open Questions

1. **~~Consent scope~~ — RESOLVED.** The published wyxr.org T&C (§5.1, §5.8) and SMS privacy policy explicitly disclose "event alerts," "community updates," "station updates," and "occasional promotional messages," which covers the broadcast use cases in §1. No policy change is a prerequisite. See §8.2.
2. **~~TCR campaign use-case verification~~ — RESOLVED.** Checked in the Twilio Console: campaign is **Verified**, use case is **`MIXED`** (not Conversational-only), and the registered description explicitly includes "program updates, event announcements, and community alerts." Broadcast traffic is registered. The registered opt-in methods (JOIN double opt-in, web form) also match this spec's audience rule exactly and exclude staff attestation, corroborating §8.3. No blocker remains. See §8.2(a).
3. **Fundraising/donation texts are not clearly authorized.** The privacy policy's "**solely** … programming, show updates, and DJ interactions" is narrower than the T&C's "occasional promotional messages." Programming and event announcements are fine; a pledge-drive ask sits in the gap. If the station wants to text donation asks — likely, for a 501(c)(3) — reconcile that privacy-policy sentence first. Policy decision, deliberately not enforced in code. See §8.2(b).
4. **~~Imported contacts~~ — RESOLVED.** Station direction: only listeners who opted in themselves receive broadcasts. `opt_in_method = 'import'` (staff-attested) contacts are excluded unconditionally — no override, no `include_imported` column. Staff who want them included re-import without the consent attestation so the listener gets a confirmation text; replying YES flips them to `'sms'` and they become eligible automatically (§8.3).
5. **`BROADCAST_MAX_RECIPIENTS` default.** This spec couldn't query the production database's actual current opted-in contact count from this environment. Whoever implements this should run the §3 query against production once and set a default with reasonable headroom above the current list size (e.g., 1.5–2×), not an arbitrary round number.
6. **Should test-send be hard-required before Confirm enables?** This spec assumes no (strongly nudged in UI, not server-enforced) to avoid blocking a genuine emergency broadcast — worth an explicit sign-off from station staff, since it trades a small safety gain for available speed.
7. **Access control.** Should broadcast-sending require something beyond the single shared admin login (§2, §11) — e.g., a distinct credential, or a "type your name to confirm" audit field beyond what's already in `created_by`? This spec deliberately doesn't invent new auth infrastructure; it's flagged here as a real gap given the feature's blast radius.
8. **Exact current Twilio per-segment rate.** The cost math in §10 uses a public-pricing planning estimate (~$0.012/segment all-in as of August 2026), not the station's actual account rate — confirm in the Twilio Console before quoting a number to station leadership.
9. **Retry/backoff constants.** 30s/60s/120s backoff, 3-attempt cap, and the 2-minute stale-claim threshold in `resumeInterruptedBroadcasts` (§7.5) are reasonable starting defaults, not validated against this station's real-world Twilio error rates — may need tuning after the first real broadcast.
10. **`messaging_enabled` scope change.** This spec extends a toggle that today only affects the DJ reply UI (§2) so that it also pauses an in-flight broadcast server-side (§11). Confirm this is the intended behavior — it's a small but real change to what that switch does.
