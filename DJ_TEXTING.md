# DJ Texting

Staff use Airroom to text the station's DJs. It is a second audience on the
existing broadcast system, sent from a **second Twilio number** (the DJ line)
with its own A2P campaign, and kept fully apart from listener contacts:

- DJs live in `dj_roster`, never in `contacts`.
- A DJ's STOP on the DJ line doesn't unsubscribe them as a listener, and vice versa.
- DJ texts never reach the on-air screen: the DJ webhook never writes
  `messages` or `contacts` and never emits `message:new`.
- DJ replies go to one private staff Slack channel, one thread per DJ.
  Staff answer a DJ by replying in that DJ's thread; the app texts the reply
  from the DJ line.

Every DJ needs a **first and last name on file** before they get any group
text. Staff can type names on the roster, or leave them blank and the app
asks the DJ by text right after they reply YES (at most 3 times).

## Who can do what

| Login | Env vars | Can |
|---|---|---|
| Staff | `STAFF_USERNAME` / `STAFF_PASSWORD` | Everything below, plus the DJ roster, DJ broadcasts and the DJ reply list |
| Shared (DJs) | `AUTH_USERNAME` / `AUTH_PASSWORD` | On-air dashboard, `/admin` messages, contacts, listener broadcasts |

- With `STAFF_*` unset, no staff login is possible.
- The server refuses to start if `STAFF_USERNAME` equals `AUTH_USERNAME`.
- Sessions created before this change have no role and count as the shared
  login, so staff need to sign in again with the staff login after deploy.
- DJ broadcasts are hidden from the shared login: every `/admin/broadcasts/:id`
  route answers 404 for a DJ broadcast unless the session is staff.

## Pages

| Page | What it does |
|---|---|
| `/admin/djs` | Roster (first name, last name, show, phone, status badge, "Needs name" badge), add/edit/remove, the "Text DJ to …" instruction, latest 50 DJ replies and staff answers with mark-read |
| `/admin/djs/message` | DJ-only compose page: live count, test send, confirm. Every text starts with `WYXR DJs: ` and ends with ` Reply STOP to opt out.` |
| `/admin/broadcasts/:id` | Shared status page (shows "DJs only" for DJ broadcasts) |

Remove sets `active = false`; rows are never deleted. Re-adding a removed DJ's
number brings the same row back.

## How a DJ signs up

The app never texts a DJ first. The registered campaign says DJs opt in by
texting the keyword.

1. Staff add the DJ on `/admin/djs` (phone required, names optional).
2. The DJ texts **DJ** to the DJ line and gets `DJ_OPT_IN_REQUEST`.
3. The DJ replies **YES** (or **Y**) and gets `DJ_OPT_IN_CONFIRMATION`. If a
   name is missing, they also get `DJ_NAME_REQUEST`.
4. The DJ texts their first and last name and gets `DJ_NAME_THANKS`.

Who gets a DJ broadcast: `active AND opted_in AND NOT opted_out` with first
and last name both non-blank (`server/services/broadcastAudience.js`).

### DJ-line keywords (`server/services/djInbound.js`)

Trimmed and case-insensitive.

| Text | From | Result |
|---|---|---|
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT, REVOKE | anyone | `opted_out` set on the roster row if one exists; logged; nothing sent (Twilio replies) |
| START, UNSTOP | anyone | `opted_out` cleared; `opted_in` left as it was; logged |
| HELP, INFO | anyone | logged only (Twilio replies) |
| DJ | active, not opted-out roster number | not signed up: opt-in request. Signed up: confirmation again, then name ask if needed |
| DJ | opted-out roster number | logged only |
| DJ | anyone else (incl. removed DJs) | "This line is for WYXR DJs. Ask station staff to add you." at most once per number per 24 hours |
| YES, Y | active roster number with a pending request | signed up (`opt_in_method = 'sms_keyword'`), confirmation, name ask if needed |
| YES, Y | anything else | logged only |
| anything | roster number the app is waiting on for a name | taken as the name: first word = first name, rest = last name. Saved, not posted to Slack. One word or too long → asked again within the limit of 3 |
| anything | roster number | saved to `dj_inbound_messages` and posted to Slack |
| anything | anyone else | logged, no reply |

All consent events are logged in `dj_consent_log`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `STAFF_USERNAME`, `STAFF_PASSWORD` | yes | Staff login. Must differ from `AUTH_USERNAME`. |
| `DJ_TWILIO_PHONE_NUMBER` | to send | E.164 DJ line. Unset = DJ sending off: DJ pages show a notice, test send and confirm return 409, Slack replies are skipped. Never falls back to `TWILIO_PHONE_NUMBER`. |
| `DJ_TWILIO_WEBHOOK_URL` | production | Exact public URL of `/webhook/dj-sms`, used for Twilio signature validation. In production every DJ webhook request is rejected while this is unset. |
| `DJ_BROADCAST_MIN_INTERVAL_MINUTES` | no | Cooldown between DJ broadcasts. Default 2. The listener cooldown (`BROADCAST_MIN_INTERVAL_MINUTES`) is separate. |
| `SLACK_BOT_TOKEN` | for Slack | Bot token (`xoxb-…`). |
| `SLACK_SIGNING_SECRET` | for Slack | From the Slack app's Basic Information page. |
| `SLACK_DJ_CHANNEL_ID` | for Slack | ID of the private staff channel. |
| `DJ_SLACK_THREAD_DAYS` | no | A DJ's thread is reused while it was active within this many days. Default 7. |
| `SMS_DRY_RUN` | local only | `true`: no text reaches Twilio (logged with a fake sid). Never set in production. |
| `SLACK_DRY_RUN` | local only | `true`: no Slack API call is made (logged with a fake ts). Never set in production. |

If any of the three Slack variables is unset, Slack is off: DJ replies are
still saved and listed on `/admin/djs`, and the page shows a notice.

## Twilio setup

1. Messaging Service **WYXR DJ line** with the DJ number, linked to the DJ
   campaign (done Nov 18; wait for the campaign to show Verified).
2. In that Messaging Service, set the incoming-message webhook to
   `https://wyxr-texting-airroom.onrender.com/webhook/dj-sms` (HTTP POST).
   Set `DJ_TWILIO_WEBHOOK_URL` to exactly the same URL.
3. Check the Messaging Service's Advanced Opt-Out: STOP and HELP replies come
   from Twilio, not the app. Make sure the HELP text names WYXR DJs.

## Slack app setup

1. Create a Slack app in the station workspace (from scratch).
2. **OAuth & Permissions → Bot Token Scopes:** `chat:write`,
   `reactions:write`, `groups:history`. Install to the workspace and copy the
   Bot User OAuth Token into `SLACK_BOT_TOKEN`.
3. **Basic Information:** copy the Signing Secret into `SLACK_SIGNING_SECRET`.
4. Create a private staff channel for DJ replies and invite the app to it
   (`/invite @AppName`). Copy the channel ID (channel details → bottom) into
   `SLACK_DJ_CHANNEL_ID`.
5. Deploy with the env vars set (the request URL must answer before Slack
   accepts it).
6. **Event Subscriptions:** turn on, request URL
   `https://wyxr-texting-airroom.onrender.com/slack/events`. Under
   **Subscribe to bot events** add `message.groups`. Save.

### How the relay behaves

- **DJ → Slack:** the post names the DJ (first and last name and show, or
  "Name not on file" with the last 4 digits) followed by their message. It
  continues the DJ's thread if that thread was active within
  `DJ_SLACK_THREAD_DAYS`, otherwise it starts a new one. A Slack failure is
  logged; the reply is kept and the Twilio webhook still succeeds.
- **Staff → DJ:** only a human reply inside a known DJ thread in the DJ
  channel is acted on. Edits, deletes, joins, bot posts, top-level posts and
  other channels are ignored. Slack retries are deduplicated by the event's
  `ts`. The reply is converted to plain text (links become `label (url)`,
  mentions are dropped), sent with the `WYXR DJs: ` prefix and STOP suffix,
  and gets a :white_check_mark: when sent.
- **Not sent** (the app says why in the thread): over 3 segments, DJ line
  off, messaging kill switch off, DJ removed, not signed up, or opted out.
  Twilio error 21610 marks the DJ opted out on the roster.
- Every request to `/slack/events` is signature-checked (HMAC-SHA256 over the
  raw body, timestamps more than 5 minutes old rejected).

## Database

Migration `server/db/migrations/007_add_dj_texting.sql` (also in
`schema.sql`, which `render-migrate.sh` re-runs):

- `dj_roster`, `dj_consent_log`, `dj_inbound_messages`, `dj_slack_threads`,
  `dj_outbound_replies`
- `broadcasts.audience` (`'listeners'` default, or `'djs'`) and
  `broadcasts.from_number` (stamped at confirm)
- `idx_broadcasts_one_active` is now one sending broadcast **per audience**.
  The worker still sends one text per tick, oldest broadcast first, so a DJ
  notice may wait behind a listener broadcast that started earlier.

## Local development and tests

```bash
createdb wyxr_texts_dj_test     # once
cd server && npm test           # node:test, dry-run Twilio and Slack, local DB only
```

The tests refuse to run against anything but a local `*_test` database,
and the Twilio and Slack services refuse real API calls under `NODE_ENV=test`.
Use only fictional 555-01xx numbers and made-up Slack IDs in code, fixtures and
docs: this repo is public.

## Known limits

- Any shared-login user can flip `messaging_enabled`, which pauses DJ sends too.
- Listener broadcasts are still available to the shared login.
- Staff can't start a one-to-one text to a DJ who hasn't written in (use a DJ broadcast).
