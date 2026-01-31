# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real-time text messaging application for WYXR 91.7 FM radio station. Listeners text a Twilio number, messages appear instantly on DJ's screen via WebSocket, and DJs can mark read/unread. Reply functionality exists but requires Twilio A2P approval.

**Deployment:** Frontend on Vercel + Backend on Render.com + PostgreSQL database on Render
**Production URL:** https://wyxr-texting-airroom.vercel.app
**Important:** Desktop/laptop only - mobile browsers have session cookie issues

## Common Commands

### Development

```bash
# Backend (Terminal 1)
cd server
npm install
npm run dev                    # Node.js with --watch flag

# Frontend (Terminal 2)
cd client
npm install
npm start                      # React dev server at localhost:3000

# Database setup (first time only)
createdb wyxr_texts
psql wyxr_texts < server/db/schema.sql
```

### Testing with Twilio (Local)

```bash
# Terminal 3
ngrok http 3001
# Then update Twilio webhook URL to: https://<ngrok-url>/webhook/sms
```

### Deployment

Changes pushed to GitHub `main` branch automatically trigger:
- Vercel: Frontend rebuild (~1-2 minutes)
- Render: Backend rebuild (~1-2 minutes)

### Database Migrations (Production)

```bash
# Run from project root
./render-migrate.sh
# Paste Render External Database URL when prompted
```

## Architecture Overview

### Critical Real-Time Path (Most Important)

**Incoming SMS Flow:**
```
Listener texts → Twilio → POST /webhook/sms → Insert DB → io.emit('message:new') → All connected clients update instantly
```

This is the core feature. The webhook at `server/routes/webhook.js` is the entry point for all incoming SMS. It:
1. Receives Twilio POST with `From` and `Body` fields
2. Inserts message into PostgreSQL `messages` table
3. Broadcasts via Socket.io to all connected DJs
4. Returns empty TwiML response `<Response></Response>`

**Key files:**
- `server/routes/webhook.js` - Twilio webhook handler
- `server/server.js` - Socket.io initialization and Express setup
- `client/src/hooks/useWebSocket.js` - Client Socket.io connection

### WebSocket State Synchronization

All clients stay synchronized via Socket.io events:
- `message:new` - New SMS received
- `message:updated` - Message marked read/unread or replied
- `settings:updated` - Messaging power toggle changed

Socket.io is attached to Express via `req.app.get('io')` and broadcast in routes.

### Session-Based Authentication

Uses `express-session` with PostgreSQL store (not in-memory):
- Sessions persist across server restarts
- Cookie with `httpOnly`, `secure: true`, `sameSite: 'none'`
- `app.set('trust proxy', 1)` for Render/Cloudflare
- Single username/password from environment variables (`AUTH_USERNAME`, `AUTH_PASSWORD`)

### 12-Hour Display Window

**Important:** Messages are stored permanently but only displayed if within 12 hours:
```sql
WHERE timestamp >= NOW() - INTERVAL '12 hours'
```
This is enforced in `server/routes/messages.js` GET endpoint. All messages remain in database for staff review via admin panel.

## Configuration

### Environment Variables

**Backend (`server/.env`):**
```bash
DATABASE_URL=postgresql://localhost:5432/wyxr_texts
SESSION_SECRET=<random-secret>
AUTH_USERNAME=wyxr
AUTH_PASSWORD=<secure-password>
TWILIO_ACCOUNT_SID=<twilio-sid>
TWILIO_AUTH_TOKEN=<twilio-token>
TWILIO_PHONE_NUMBER=+1234567890
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

**Frontend (`client/.env`):**
```bash
REACT_APP_API_URL=http://localhost:3001
REACT_APP_LISTENER_PHONE=901-460-3031
```

### CORS Configuration

CORS is critical for cross-origin cookies:
- `credentials: true` in both server and client
- `origin: process.env.FRONTEND_URL` (explicit, not wildcard)
- `exposedHeaders: ['set-cookie']` for cookie sharing
- `app.set('trust proxy', 1)` for Render proxy

### Database Schema

Three main tables:
- `messages` - SMS messages with read/replied status
- `settings` - Key-value store (currently just `messaging_enabled`)
- `session` - Express session store (managed by connect-pg-simple)

Indexes on `messages.timestamp`, `messages.read`, `messages.phone` for performance.

## Code Architecture Patterns

### Frontend State Management

`App.jsx` is the main state container:
- Manages authentication state
- Fetches messages on mount
- Listens to WebSocket events and updates state
- Passes callbacks down to components

Components are deliberately kept simple - no Redux or complex state management. All state flows through props.

### Backend Route Pattern

All protected routes use `requireAuth` middleware from `server/middleware/auth.js`:
```javascript
router.get('/messages', requireAuth, async (req, res) => {
  // Route handler
});
```

Routes that need to broadcast WebSocket events access Socket.io via:
```javascript
const io = req.app.get('io');
io.emit('message:updated', message);
```

### Phone Number Handling

Phone numbers from Twilio come in E.164 format (`+19014603031`). Frontend formats them as `(901) 460-3031` using `utils/formatters.js`.

Never hardcode the listener-facing phone number - always use `process.env.REACT_APP_LISTENER_PHONE`.

## Important Notes

### Read vs. Unread Visual Distinction

This is a critical UX element:
- **Unread:** Yellow background (`#FFC629`), pink border (`#E9407A`), bold text, pulsing dot
- **Read:** Dim gray background, subtle border, normal weight

The visual contrast must be obvious from 6-8 feet away (DJ's viewing distance).

### Reply Functionality Status

Reply modal and backend endpoints exist but SMS sending is blocked until Twilio A2P approval. The Reply button is currently hidden in `MessageCard.jsx` (commented out). When A2P is approved, uncomment the button.

### Admin Panel

`/admin/messages` is a server-rendered HTML page (not React) for staff to view all messages and delete inappropriate ones. Uses same session authentication.

### Twilio Webhook Format

Twilio sends POST with `application/x-www-form-urlencoded`:
```javascript
router.post('/sms', express.urlencoded({ extended: false }), async (req, res) => {
  const { From, Body } = req.body;
  // ...
});
```

Always return valid TwiML even on error: `<Response></Response>`

### Getting Started Modal

DJs access on-air instructions via modal (`GettingStarted.jsx`) triggered by help button in header. Content emphasizes:
- Using the app is optional
- Creating great radio is priority #1
- Won't get many texts (radio is passive)
- Must promote on-air multiple times

## Brand Colors

Strictly enforce WYXR brand colors:
- **Yellow:** `#FFC629` (primary, headers, titles)
- **Pink:** `#E9407A` (accent, borders, unread indicator)
- **Blue:** `#2B9EB3` (interactive elements, buttons)
- **Dark:** `#2B2B2B` (backgrounds)

## Troubleshooting

### Messages Not Appearing
1. Check Render service is "Live" (free tier spins down after 15min idle)
2. Verify Twilio webhook URL in Twilio console
3. Check Render logs for webhook errors

### Session/Auth Issues
- Verify `trust proxy` is set to `1`
- Check `SESSION_SECRET` environment variable
- Ensure `FRONTEND_URL` matches actual Vercel URL

### WebSocket Connection Failures
- Should auto-reconnect (10 attempts with 1s delay)
- Check CORS configuration
- Verify `withCredentials: true` in client

### Cold Start Delays
Render free tier spins down after 15min idle. First request takes 50+ seconds. Frontend stays fast via Vercel CDN.

## Related Documentation

- `README.md` - Full setup and deployment guide
- `ARCHITECTURE.md` - Detailed system architecture with diagrams
- `DEPLOYMENT_STATUS.md` - Current deployment status and checklist
- `FEATURE_REQUESTS.md` - Future enhancements (A2P reply, voice messages)
