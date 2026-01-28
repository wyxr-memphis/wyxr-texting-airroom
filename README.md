# WYXR 91.7 FM - Listener Text App

Real-time text messaging application for WYXR radio station. Listeners text a dedicated Twilio number, messages appear instantly on DJ's screen via WebSocket, and DJs can mark read/unread and reply via SMS.

## Features

- **Real-time Messaging**: WebSocket-powered instant message delivery
- **24-Hour Display Window**: Shows messages from the last 24 hours only (stored permanently)
- **Read/Unread Tracking**: Visual distinction between read and unread messages
- **SMS Integration**: Send and receive SMS via Twilio
- **Power Toggle**: Turn messaging on/off
- **Quick Reply Templates**: 4 predefined response templates
- **Simple Authentication**: Universal username/password login
- **WYXR Branding**: Custom color scheme (Yellow #FFC629, Pink #E9407A, Blue #2B9EB3, Dark #2B2B2B)

## Tech Stack

- **Frontend**: React, Socket.io-client, Lucide icons
- **Backend**: Node.js, Express, Socket.io, Twilio SDK
- **Database**: PostgreSQL
- **Authentication**: Express-session with PostgreSQL store
- **Deployment**: Railway (backend + PostgreSQL) + Vercel (frontend)

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

### Railway (Backend + Database)

1. **Create Railway Project**:
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Provision PostgreSQL"
   - Connect your GitHub repository

2. **Configure Environment Variables**:
   ```
   SESSION_SECRET=<generate-random-string>
   AUTH_USERNAME=wyxr
   AUTH_PASSWORD=<secure-password>
   TWILIO_ACCOUNT_SID=<your-sid>
   TWILIO_AUTH_TOKEN=<your-token>
   TWILIO_PHONE_NUMBER=<your-twilio-number>
   NODE_ENV=production
   FRONTEND_URL=<your-vercel-url>
   ```
   Note: `DATABASE_URL` is automatically provided by Railway

3. **Run Database Migrations**:
   ```bash
   railway run psql $DATABASE_URL < server/db/schema.sql
   ```

4. **Deploy**: Railway auto-deploys on git push

5. **Get Backend URL**: Copy the public URL from Railway dashboard (e.g., `https://wyxr-backend.up.railway.app`)

### Vercel (Frontend)

1. **Create Vercel Project**:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Set **Root Directory** to `client`

2. **Configure Environment Variables**:
   ```
   REACT_APP_API_URL=<your-railway-url>
   ```

3. **Deploy**: Vercel auto-deploys on git push

4. **Get Frontend URL**: Copy the URL from Vercel dashboard (e.g., `https://wyxr-text-app.vercel.app`)

### Update Twilio Webhook (Production)

In Twilio Console:
- Set webhook to: `https://your-railway-url.up.railway.app/webhook/sms`
- HTTP method: POST

### Update CORS Configuration

After deploying, update the `FRONTEND_URL` in Railway to match your Vercel URL.

## API Endpoints

### Authentication
- `POST /api/login` - Login with username/password
- `GET /api/verify` - Verify session
- `POST /api/logout` - Logout

### Messages
- `GET /api/messages` - Get messages from last 24 hours
- `PATCH /api/messages/:id/read` - Toggle read status
- `POST /api/messages/:id/reply` - Send SMS reply

### Settings
- `GET /api/settings/messaging-enabled` - Get messaging status
- `POST /api/settings/messaging-enabled` - Toggle messaging on/off

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
2. **View Messages**: All messages from the last 24 hours are displayed in a grid
3. **Mark Read/Unread**: Click on any message card to toggle read status
4. **Reply to Message**: Click the phone number to open reply modal
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
- Review Railway logs for errors

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
- Review Railway/Vercel build logs

## Development Notes

- Messages are permanently stored but only displayed if within 24 hours
- Session persists for 30 days
- WebSocket automatically reconnects on disconnect
- All timestamps are stored in UTC
- Phone numbers are formatted as (XXX) XXX-XXXX

## License

Private project for WYXR 91.7 FM

## Support

For issues or questions, contact the development team.
