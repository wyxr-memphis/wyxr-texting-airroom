# WYXR 91.7 FM - Listener Text App

Real-time text messaging application for WYXR radio station. Listeners text a dedicated Twilio number, messages appear instantly on DJ's screen via WebSocket, and DJs can mark read/unread and reply via SMS.

## 🌐 Live Production App

**App URL:** https://wyxr-texting-airroom.vercel.app
**Text Number:** [Contact WYXR for number]
**Login:** Contact WYXR staff for credentials

**Admin Panel:** https://wyxr-texting-airroom.onrender.com/admin/login (works on mobile)

## Features

- **Real-time Messaging**: WebSocket-powered instant message delivery
- **Conversation Threading**: Messages from the same listener grouped into a single thread, sorted by most recent activity
- **2-Hour Display Window**: Shows messages from the last 2 hours only (stored permanently for admin review)
- **Contact Names**: Listener first names shown on message cards; editable in admin panel
- **Read/Unread Tracking**: Unread messages glow yellow with pink border; read messages are gray
- **SMS Replies**: DJs can reply to listeners who have opted in (A2P 10DLC approved)
- **Power Toggle**: Turn messaging on/off
- **Quick Reply Templates**: 4 predefined response templates
- **Simple Authentication**: Universal username/password login
- **Admin Panel**: Full message history, contact management (CSV import, manual add, name editing, block/unblock)
- **TCPA-Compliant Opt-In**: All contacts go through SMS opt-in; STOP is always honored; opted-out numbers can never be re-added
- **WYXR Branding**: Custom color scheme (Yellow #FFC629, Pink #E9407A, Blue #2B9EB3, Dark #2B2B2B)

## Tech Stack

- **Frontend**: React, Socket.io-client, Lucide icons
- **Backend**: Node.js, Express, Socket.io, Twilio SDK
- **Database**: PostgreSQL
- **Authentication**: Express-session with PostgreSQL store
- **Deployment**: Render.com (backend + PostgreSQL) + Vercel (frontend)

## Project Structure

```
wyxr-texting-airroom/
├── client/                 # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom hooks
│   │   ├── services/      # API services
│   │   ├── utils/         # Utility functions
│   │   ├── App.jsx        # Main app component
│   │   └── index.js       # Entry point
│   ├── package.json
│   └── vercel.json        # Vercel deployment config
│
├── server/                # Node.js backend
│   ├── config/           # Configuration files
│   ├── db/               # Database schema and migrations
│   ├── middleware/       # Express middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic services
│   ├── websocket/        # WebSocket handlers
│   ├── server.js         # Main server file
│   └── package.json
│
├── railway.json          # Railway deployment config
└── README.md
```

## Local Development Setup

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Twilio account (for SMS)

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd wyxr-texting-airroom

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Database Setup

Create a PostgreSQL database:

```bash
createdb wyxr_texts
```

Run the schema:

```bash
psql wyxr_texts < server/db/schema.sql
```

### 3. Server Configuration

Create `server/.env`:

```bash
# Database
DATABASE_URL=postgresql://localhost:5432/wyxr_texts

# Session
SESSION_SECRET=your-secret-key-change-this

# Auth (hardcoded credentials)
AUTH_USERNAME=wyxr
AUTH_PASSWORD=your-secure-password

# Twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Server
PORT=3001
NODE_ENV=development

# CORS
FRONTEND_URL=http://localhost:3000
```

### 4. Client Configuration

Create `client/.env`:

```bash
REACT_APP_API_URL=http://localhost:3001
```

### 5. Start Development Servers

Terminal 1 (Backend):
```bash
cd server
npm run dev
```

Terminal 2 (Frontend):
```bash
cd client
npm start
```

The app will open at `http://localhost:3000`

### 6. Twilio Webhook Setup (Local Testing)

For local development with Twilio:

1. Install ngrok: `npm install -g ngrok`
2. Start ngrok: `ngrok http 3001`
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. In Twilio Console:
   - Go to your phone number settings
   - Set "A MESSAGE COMES IN" webhook to: `https://abc123.ngrok.io/webhook/sms`
   - Set HTTP method to POST

## Production Deployment

**Current Setup:** Backend on Render.com + Frontend on Vercel

### Render.com (Backend + Database)

1. **Create Render Account**:
   - Go to [render.com](https://render.com)
   - Sign up with GitHub

2. **Create PostgreSQL Database**:
   - Click "New +" → "PostgreSQL"
   - Name: `wyxr-texting-db`
   - Region: Choose closest to you
   - Free tier is fine
   - Click "Create Database"
   - Copy the **External Database URL** for migration

3. **Run Database Migration** (from your local machine):
   ```bash
   ./render-migrate.sh
   # Paste the External Database URL when prompted
   ```

4. **Create Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Name: `wyxr-texting-airroom`
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Region: Same as database

5. **Configure Environment Variables**:
   ```
   SESSION_SECRET=<generate-random-string>
   AUTH_USERNAME=wyxr
   AUTH_PASSWORD=<secure-password>
   TWILIO_ACCOUNT_SID=<your-sid>
   TWILIO_AUTH_TOKEN=<your-token>
   TWILIO_PHONE_NUMBER=<your-twilio-number>
   TWILIO_WEBHOOK_URL=https://your-render-url.onrender.com/webhook/sms
   NODE_ENV=production
   PORT=10000
   FRONTEND_URL=<your-vercel-url>
   ```
   Note: `DATABASE_URL` is automatically provided by Render's PostgreSQL

6. **Deploy**: Click "Create Web Service" - Render auto-deploys on git push

7. **Get Backend URL**: Copy from dashboard (e.g., `https://wyxr-texting-airroom.onrender.com`)

### Vercel (Frontend)

1. **Create Vercel Project**:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Set **Root Directory** to `client`

2. **Configure Environment Variables**:
   No environment variables needed — API calls use Vercel rewrites to proxy to Render.

3. **Deploy**: Vercel auto-deploys on git push

4. **Get Frontend URL**: Copy the URL from Vercel dashboard (e.g., `https://wyxr-text-app.vercel.app`)

### Update Twilio Webhook (Production)

In Twilio Console:
- Go to Phone Numbers → Manage → Active Numbers
- Click your number
- Scroll to "Messaging Configuration"
- Set "A MESSAGE COMES IN" webhook to: `https://your-render-url.onrender.com/webhook/sms`
- HTTP method: POST
- Click "Save Configuration"

**Important:** In production the webhook validates Twilio's `X-Twilio-Signature`
header against `TWILIO_WEBHOOK_URL`. That env var must exactly match the URL
configured in Twilio (including scheme and path). If the backend URL ever
changes, update both the Twilio console and `TWILIO_WEBHOOK_URL`, or incoming
SMS will be rejected with 403.

### Update CORS Configuration

After deploying frontend to Vercel:
1. Update `FRONTEND_URL` in Render to match your Vercel URL
2. Render will automatically redeploy with new CORS settings

## API Endpoints

### Authentication
- `POST /api/login` - Login with username/password
- `GET /api/verify` - Verify session
- `POST /api/logout` - Logout

### Messages
- `GET /api/messages` - Get messages from last 2 hours
- `PATCH /api/messages/:id/read` - Toggle read status
- `POST /api/messages/:id/reply` - Send SMS reply

### Settings
- `GET /api/settings/messaging-enabled` - Get messaging status
- `POST /api/settings/messaging-enabled` - Toggle messaging on/off

### Admin (session auth required)
- `GET /admin/messages` - Full message history (server-rendered)
- `GET /admin/contacts` - Contact list with import/edit UI (server-rendered)
- `POST /admin/contacts/import` - Bulk import contacts (JSON, max 200/batch)
- `PATCH /admin/contacts/:phone` - Update contact first name

### Webhook
- `POST /webhook/sms` - Twilio incoming SMS webhook

### Health
- `GET /health` - Health check endpoint

## WebSocket Events

### Server → Client
- `message:new` - New message received
- `message:updated` - Message updated (read/unread, replied)
- `settings:updated` - Messaging enabled/disabled

## Usage

1. **Login**: Enter credentials to access the dashboard
2. **View Messages**: Messages from the last 2 hours, grouped by listener into conversation threads; contact names shown if available
3. **Mark All Read**: Click "Mark All Read" on a thread to clear all unread messages in it
4. **Reply to Message**: Click "Reply" on any thread where the listener has opted in
5. **Quick Replies**: Use predefined templates or write custom reply
6. **Power Toggle**: Turn messaging on/off using the power button in header

## Color Scheme

- **Yellow**: `#FFC629` - Primary brand color (headers, titles)
- **Pink**: `#E9407A` - Accent color (borders, alerts, unread indicator)
- **Blue**: `#2B9EB3` - Interactive elements (buttons, links)
- **Dark**: `#2B2B2B` - Background color

## Troubleshooting

### Messages not appearing in real-time
- Check WebSocket connection in browser console
- Verify `FRONTEND_URL` matches actual frontend URL
- Check CORS configuration

### SMS not sending/receiving
- Verify Twilio credentials in environment variables
- Check Twilio webhook is set correctly
- Check Twilio phone number is active
- Review Render logs for errors

### Database connection issues
- Verify `DATABASE_URL` is correct
- Check PostgreSQL is running (local) or accessible (production)
- Run migrations if tables don't exist

### Session issues
- Clear browser cookies
- Verify `SESSION_SECRET` is set
- Check session table exists in database

### Build/deployment errors
- Ensure all environment variables are set
- Check Node.js version compatibility
- Review Render/Vercel build logs

## Development Notes

- Messages are permanently stored but only displayed if within 2 hours (full history in admin panel)
- Session persists for 30 days
- WebSocket automatically reconnects on disconnect
- All timestamps are stored in UTC
- Phone numbers are formatted as (XXX) XXX-XXXX

## License

Private project for WYXR 91.7FM

## Support

For issues or questions, contact the development team. 
