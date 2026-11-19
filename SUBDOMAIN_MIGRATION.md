# Moving Airroom to a wyxr.org subdomain (plan, not done)

Status: **not started.** This is reference material for a future `/plan`
session. Nothing here has been changed in Render, Vercel, Twilio, Slack or DNS.

## Where things are today

| Piece | Host today | Notes |
|---|---|---|
| React on-air dashboard | `wyxr-texting-airroom.vercel.app` (Vercel) | `client/vercel.json` rewrites `/api/*`, `/webhook/*` and `/socket.io/*` to Render |
| Express API, admin pages, webhooks | `wyxr-texting-airroom.onrender.com` (Render) | Admin is at `/admin/login` on this host |
| Real-time socket | Straight to `wyxr-texting-airroom.onrender.com` | Hardcoded in `client/src/hooks/useWebSocket.js`; signed `wsToken` auth because the session cookie lives on the Vercel host |
| Listener SMS webhook | `…onrender.com/webhook/sms` | Twilio signature checked against `TWILIO_WEBHOOK_URL` |
| DJ SMS webhook | `…onrender.com/webhook/dj-sms` | Checked against `DJ_TWILIO_WEBHOOK_URL` |
| Slack events | `…onrender.com/slack/events` | Set in the Slack app's Event Subscriptions |
| Database | Render Postgres | Not affected by a domain change |

## Recommended approach

Add custom domains **on top of** the current ones. The `vercel.app` and
`onrender.com` addresses keep working throughout, so nothing breaks while DNS
propagates. Each outside service can then be moved one at a time, and
rollback just means pointing it back.

Suggested names (decide in `/plan`):

- `airroom.wyxr.org` → Vercel (on-air dashboard; what DJs bookmark)
- `airroom-api.wyxr.org` → Render (API, webhooks, Slack, socket)

**Option to consider:** also send `/admin/*` through a Vercel rewrite, so
staff use `airroom.wyxr.org/admin/login` and never see the API hostname. That
needs testing first: form POSTs, the redirects, and the CSRF Origin check
(the Origin would become `https://airroom.wyxr.org`).

**Out of scope** (possible later project): serving the React build from
Express, which would remove Vercel and the cookie split. That is an
architecture change, not a domain change.

## Steps

### 1. Small code change first (deploy before any DNS work)

- `server/app.js` `allowedOrigins`: add `https://airroom.wyxr.org` (and the
  API host if admin pages are served there). The list is used for CORS, the
  socket's CORS and the CSRF Origin check.
- `server/routes/webhook.js`: accept **either** the old or the new URL when
  checking Twilio signatures. For example, let `TWILIO_WEBHOOK_URL` and
  `DJ_TWILIO_WEBHOOK_URL` take a comma-separated list and pass if any URL
  validates. Today the URL must match exactly, so if the env var and the
  Twilio console are changed at different moments, every incoming text in
  between gets a 403 and is lost.
- Add tests for both of those.

### 2. DNS and TLS

- Find out where wyxr.org DNS is managed (open question: the WordPress host,
  a registrar or Cloudflare).
- Render: service → Settings → Custom Domains → add `airroom-api.wyxr.org`,
  then create the CNAME it asks for (to `wyxr-texting-airroom.onrender.com`).
  TLS is automatic.
- Vercel: project → Domains → add `airroom.wyxr.org`, then create the CNAME
  it asks for (`cname.vercel-dns.com`).
- Check that both plans allow custom domains (Render free web service, Vercel
  Hobby).
- If DNS is on Cloudflare, use DNS-only (grey cloud) at first so Render and
  Vercel can issue certificates.
- Verify: `curl https://airroom-api.wyxr.org/health` returns 200 and the
  dashboard loads at `https://airroom.wyxr.org`.

### 3. Point the app at the new names

- Render env: `FRONTEND_URL=https://airroom.wyxr.org`.
- Optional: change the Render host in `client/vercel.json` rewrites and in
  `useWebSocket.js` to `airroom-api.wyxr.org`. It isn't required, because the
  `onrender.com` host keeps working. Leaving the rewrites on `onrender.com`
  avoids a dependency on our DNS for server-to-server calls.
- Leave `RENDER_EXTERNAL_URL` alone (Render sets it; keep-alive uses it).

### 4. Move outside services, one at a time

For each one, send a test and watch the Render logs before moving on.

1. **Twilio listener number:** set the incoming webhook to
   `https://airroom-api.wyxr.org/webhook/sms`. Then set `TWILIO_WEBHOOK_URL`
   to the new URL, or the old+new list from step 1. Text the listener line.
2. **Twilio DJ Messaging Service:** same for `/webhook/dj-sms` and
   `DJ_TWILIO_WEBHOOK_URL`. Text the DJ line.
3. **Slack app:** Event Subscriptions → Request URL →
   `https://airroom-api.wyxr.org/slack/events`. Slack re-verifies it on the
   spot. Socket Mode stays off. Reply in a DJ thread and check for the ✅.
4. **A2P campaigns:** a webhook change needs no campaign update. Check
   whether either campaign's opt-in description or sample messages mention
   the old app URL; privacy and terms links are on wyxr.org already.

### 5. People

- Everyone signs in once more on the new address. Session cookies are tied to
  the host, so they don't carry over.
- Update DJ bookmarks, on-air instructions, any printed sheets or QR codes in
  the studio, and the staff note about the DJ line (admin login URL).
- Keep the old URLs working. Later, Vercel can redirect `vercel.app` to the
  new domain; Render can't redirect `onrender.com`, but it doesn't need to.

### 6. Docs

Update every place that names a URL: `CLAUDE.md` (Production URL, Admin
Panel), `README.md`, `DJ_TEXTING.md` (Twilio and Slack setup URLs),
`CREDENTIALS.md`, `DEPLOYMENT_STATUS.md`, `ARCHITECTURE.md`,
`TWILIO_WEBHOOK_SETUP.md`, `server/.env.example`. Find them with
`git grep -n "onrender\.com\|vercel\.app"`.

## Rollback

The old domains are never removed. To roll back, set the Twilio webhooks,
the Slack Request URL, `FRONTEND_URL` and the `*_WEBHOOK_URL` env vars back
to the `onrender.com` / `vercel.app` values.

## Optional follow-up once both hosts are on wyxr.org

Both hosts would be on wyxr.org, so the browser treats them as the same site.
That opens up simplifications, each to be tested on its own:

- The session cookie could go back to `sameSite: 'lax'`
  (`server/config/session.js`), which reduces how much the CSRF Origin check
  has to do.
- A cookie set for `.wyxr.org` could let the socket use the session directly
  instead of the `wsToken`. That workaround works today, so only consider it
  if it causes trouble.

## Open questions for /plan

- Subdomain names (`airroom` / `airroom-api`, `texts`, or something else).
- Who manages wyxr.org DNS, and who can add records.
- Should admin pages move behind the Vercel domain (single URL for staff)?
- When to cut over: a quiet time when no live show is relying on texts.
