# WYXR Text App - Architecture Documentation

This document provides a visual and technical overview of the WYXR Listener Text App architecture.

---

## System Architecture Diagram

```mermaid
graph TB
    subgraph "External Services"
        Listener[📱 Listener<br/>SMS Sender]
        Twilio[☁️ Twilio API<br/>SMS Gateway]
    end

    subgraph "Frontend - Vercel"
        Browser[🌐 Browser<br/>React App]
        ReactComponents[⚛️ React Components<br/>- Header<br/>- MessageFeed<br/>- MessageCard<br/>- ReplyModal<br/>- Login]
        SocketClient[🔌 Socket.io Client<br/>WebSocket Connection]
        APIClient[📡 API Service<br/>HTTP Requests]
    end

    subgraph "Backend - Render.com"
        Express[🚀 Express Server<br/>Node.js<br/>Port 10000]

        subgraph "Routes"
            AuthRoutes[🔐 /api/login<br/>/api/verify<br/>/api/logout]
            MessageRoutes[💬 /api/messages<br/>/api/messages/:id/read<br/>/api/messages/:id/reply]
            SettingsRoutes[⚙️ /api/settings/messaging-enabled]
            WebhookRoutes[📥 /webhook/sms<br/>Twilio Incoming]
            AdminRoutes[👤 /admin/messages<br/>Admin Panel]
        end

        subgraph "Middleware"
            SessionMW[🎫 Express Session<br/>PostgreSQL Store]
            AuthMW[🔒 Authentication<br/>requireAuth]
            CORS[🌍 CORS<br/>Credentials: true]
        end

        SocketServer[🔌 Socket.io Server<br/>WebSocket Server]
        TwilioService[📞 Twilio Service<br/>Send SMS]
    end

    subgraph "Database - Render PostgreSQL"
        DB[(🗄️ PostgreSQL<br/>Database)]

        subgraph "Tables"
            MessagesTable[📋 messages<br/>- id, phone, text<br/>- timestamp, read<br/>- replied, reply_text]
            SettingsTable[⚙️ settings<br/>- key, value<br/>- messaging_enabled]
            SessionTable[🎫 session<br/>- sid, sess, expire]
        end
    end

    %% User Flow - SMS Receiving
    Listener -->|1. Sends SMS| Twilio
    Twilio -->|2. POST /webhook/sms| WebhookRoutes
    WebhookRoutes -->|3. Insert message| MessagesTable
    WebhookRoutes -->|4. io.emit('message:new')| SocketServer
    SocketServer -->|5. WebSocket push| SocketClient
    SocketClient -->|6. Update UI| ReactComponents

    %% User Flow - DJ Login
    Browser -->|Login credentials| APIClient
    APIClient -->|POST /api/login| AuthRoutes
    AuthRoutes -->|Validate| SessionMW
    SessionMW -->|Store session| SessionTable
    AuthRoutes -->|Session cookie| Browser

    %% User Flow - View Messages
    Browser -->|Load app| APIClient
    APIClient -->|GET /api/messages| MessageRoutes
    MessageRoutes -->|Query last 12h| MessagesTable
    MessagesTable -->|Return messages| MessageRoutes
    MessageRoutes -->|JSON response| ReactComponents

    %% User Flow - WebSocket Connection
    Browser -->|Connect| SocketClient
    SocketClient -->|Authenticate with session| SocketServer
    SocketServer -->|Verify session| SessionMW

    %% User Flow - Mark Read/Unread
    ReactComponents -->|Click Mark Read| APIClient
    APIClient -->|PATCH /api/messages/:id/read| MessageRoutes
    MessageRoutes -->|Update read status| MessagesTable
    MessageRoutes -->|io.emit('message:updated')| SocketServer
    SocketServer -->|Broadcast to all clients| SocketClient

    %% User Flow - Reply to Message (when A2P approved)
    ReactComponents -->|Click Reply| APIClient
    APIClient -->|POST /api/messages/:id/reply| MessageRoutes
    MessageRoutes -->|Send SMS| TwilioService
    TwilioService -->|API call| Twilio
    Twilio -->|Deliver SMS| Listener
    MessageRoutes -->|Update replied status| MessagesTable
    MessageRoutes -->|io.emit('message:updated')| SocketServer

    %% Admin Panel
    Browser -->|/admin/messages| AdminRoutes
    AdminRoutes -->|SELECT * FROM messages| MessagesTable
    AdminRoutes -->|Render HTML table| Browser

    %% Styling
    classDef frontend fill:#2B9EB3,stroke:#FFC629,stroke-width:3px,color:#fff
    classDef backend fill:#E9407A,stroke:#FFC629,stroke-width:3px,color:#fff
    classDef database fill:#FFC629,stroke:#E9407A,stroke-width:3px,color:#2B2B2B
    classDef external fill:#666,stroke:#999,stroke-width:2px,color:#fff

    class Browser,ReactComponents,SocketClient,APIClient frontend
    class Express,AuthRoutes,MessageRoutes,SettingsRoutes,WebhookRoutes,AdminRoutes,SessionMW,AuthMW,CORS,SocketServer,TwilioService backend
    class DB,MessagesTable,SettingsTable,SessionTable database
    class Listener,Twilio external
```

---

## Technology Stack

### Frontend (Vercel)
- **Framework**: React 18.2
- **Build Tool**: Create React App
- **Styling**: Custom CSS with WYXR brand colors
- **Icons**: Lucide React
- **Real-time**: Socket.io Client 4.6
- **Deployment**: Vercel (Auto-deploy from GitHub main branch)
- **URL**: https://wyxr-texting-airroom.vercel.app

### Backend (Render.com)
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Real-time**: Socket.io Server
- **Session**: express-session with connect-pg-simple
- **SMS**: Twilio SDK
- **Deployment**: Render Web Service (Auto-deploy from GitHub main branch)
- **URL**: https://wyxr-texting-airroom.onrender.com

### Database (Render PostgreSQL)
- **Database**: PostgreSQL 14+
- **Tables**: messages, settings, session
- **Connection**: Internal URL for backend, External URL for migrations
- **Hosting**: Render PostgreSQL Service

### External Services
- **SMS Gateway**: Twilio
- **A2P Registration**: Twilio 10DLC (Pending approval)
- **Version Control**: GitHub (Public repo)

---

## Data Flow Diagrams

### 1. Incoming SMS Flow

```
┌──────────┐
│ Listener │
│  Sends   │
│   SMS    │
└────┬─────┘
     │
     ▼
┌──────────────┐
│    Twilio    │
│ Receives SMS │
└──────┬───────┘
       │
       │ POST /webhook/sms
       │ (phone, text, timestamp)
       ▼
┌─────────────────────┐
│  Backend /webhook   │
│  Receives Webhook   │
└──────────┬──────────┘
           │
           ├─► INSERT INTO messages (phone, text, timestamp)
           │
           └─► io.emit('message:new', message)
                      │
                      ▼
           ┌──────────────────────┐
           │  All Connected DJs   │
           │  Receive via         │
           │  WebSocket           │
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │  Message appears in  │
           │  UI instantly        │
           │  (Yellow card with   │
           │   pink border)       │
           └──────────────────────┘
```

### 2. DJ Reply Flow (When A2P Approved)

```
┌──────────────────┐
│   DJ clicks      │
│  "Reply" button  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Reply Modal     │
│  Opens with      │
│  Quick Templates │
└────────┬─────────┘
         │
         │ POST /api/messages/:id/reply
         │ {replyText: "Thanks!"}
         ▼
┌──────────────────────┐
│  Backend             │
│  /api/messages/reply │
└──────┬───────────────┘
       │
       ├─► Twilio.sendSMS(phone, replyText)
       │          │
       │          ▼
       │   ┌─────────────┐
       │   │   Twilio    │
       │   │  Sends SMS  │
       │   └──────┬──────┘
       │          │
       │          ▼
       │   ┌─────────────┐
       │   │  Listener   │
       │   │ Receives SMS│
       │   └─────────────┘
       │
       ├─► UPDATE messages SET replied=true, reply_text=?, replied_at=NOW()
       │
       └─► io.emit('message:updated', message)
                  │
                  ▼
           ┌──────────────────┐
           │  All DJs see     │
           │  reply status    │
           │  update in       │
           │  real-time       │
           └──────────────────┘
```

### 3. Authentication Flow

```
┌──────────────┐
│   DJ opens   │
│     app      │
└──────┬───────┘
       │
       │ GET /
       ▼
┌──────────────┐
│   React App  │
│    Loads     │
└──────┬───────┘
       │
       │ GET /api/verify
       ▼
┌──────────────────┐        ┌──────────────┐
│   Backend        │───────▶│   Session    │
│ Checks Session   │        │   Table      │
└──────┬───────────┘        └──────────────┘
       │
       ├─► If Valid: Return user data
       │
       └─► If Invalid: Show login screen
                │
                ▼
         ┌─────────────────┐
         │  DJ enters      │
         │  credentials    │
         └────────┬────────┘
                  │
                  │ POST /api/login
                  │ {username, password}
                  ▼
         ┌─────────────────────┐
         │  Backend validates  │
         │  against env vars   │
         │  AUTH_USERNAME      │
         │  AUTH_PASSWORD      │
         └────────┬────────────┘
                  │
                  ├─► Valid: Create session, return cookie
                  │
                  └─► Invalid: Return 401 error
```

---

## File Structure

```
wyxr-texting-airroom/
├── client/                          # Frontend React App
│   ├── public/
│   │   ├── index.html              # Main HTML template
│   │   ├── favicon.svg             # WYXR branded icon
│   │   └── apple-touch-icon.png    # iOS icon (optional)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx          # Top navigation with listener info
│   │   │   ├── Header.css
│   │   │   ├── MessageFeed.jsx     # Grid container for messages
│   │   │   ├── MessageFeed.css
│   │   │   ├── MessageCard.jsx     # Individual message card
│   │   │   ├── MessageCard.css
│   │   │   ├── ReplyModal.jsx      # Reply interface
│   │   │   ├── ReplyModal.css
│   │   │   ├── Login.jsx           # Authentication form
│   │   │   └── Login.css
│   │   ├── hooks/
│   │   │   └── useWebSocket.js     # WebSocket connection hook
│   │   ├── services/
│   │   │   └── api.js              # API client functions
│   │   ├── utils/
│   │   │   └── formatters.js       # Phone/time formatting
│   │   ├── App.jsx                 # Main app component
│   │   ├── App.css                 # Global styles
│   │   └── index.js                # React entry point
│   ├── package.json                # Frontend dependencies
│   └── .env.example                # Frontend env template
│
├── server/                          # Backend Node.js App
│   ├── config/
│   │   ├── database.js             # PostgreSQL connection pool
│   │   └── session.js              # Session configuration
│   ├── db/
│   │   └── schema.sql              # Database schema
│   ├── middleware/
│   │   └── auth.js                 # Authentication middleware
│   ├── routes/
│   │   ├── auth.js                 # Login/logout/verify routes
│   │   ├── messages.js             # Message CRUD routes
│   │   ├── settings.js             # App settings routes
│   │   ├── webhook.js              # Twilio SMS webhook
│   │   └── admin.js                # Admin panel routes
│   ├── services/
│   │   └── twilio.js               # Twilio SMS service
│   ├── websocket/
│   │   └── handlers.js             # Socket.io event handlers
│   ├── server.js                   # Main server entry point
│   ├── package.json                # Backend dependencies
│   └── .env.example                # Backend env template
│
├── ARCHITECTURE.md                  # This file
├── README.md                        # Project overview
├── DEPLOYMENT_STATUS.md             # Deployment checklist
├── FEATURE_REQUESTS.md              # Future enhancements
├── CREDENTIALS.md                   # Internal credentials (gitignored)
├── render-migrate.sh                # Database migration script
└── .gitignore                       # Git ignore rules
```

---

## API Endpoints Reference

### Authentication Routes (`/api`)

| Method | Endpoint       | Description              | Auth Required |
|--------|----------------|--------------------------|---------------|
| POST   | `/login`       | Login with credentials   | No            |
| GET    | `/verify`      | Check session status     | No            |
| POST   | `/logout`      | Destroy session          | Yes           |

### Message Routes (`/api`)

| Method | Endpoint                  | Description                | Auth Required |
|--------|---------------------------|----------------------------|---------------|
| GET    | `/messages`               | Get messages (last 12h)    | Yes           |
| PATCH  | `/messages/:id/read`      | Toggle read status         | Yes           |
| POST   | `/messages/:id/reply`     | Send SMS reply             | Yes           |

### Settings Routes (`/api`)

| Method | Endpoint                      | Description              | Auth Required |
|--------|-------------------------------|--------------------------|---------------|
| GET    | `/settings/messaging-enabled` | Get messaging on/off     | Yes           |
| POST   | `/settings/messaging-enabled` | Toggle messaging         | Yes           |

### Webhook Routes

| Method | Endpoint       | Description            | Auth Required |
|--------|----------------|------------------------|---------------|
| POST   | `/webhook/sms` | Twilio incoming SMS    | No (Twilio)   |

### Admin Routes

| Method | Endpoint                | Description              | Auth Required |
|--------|-------------------------|--------------------------|---------------|
| GET    | `/admin/messages`       | View all messages (HTML) | Yes           |
| DELETE | `/admin/messages/:id`   | Delete message           | Yes           |

### Health Check

| Method | Endpoint   | Description              | Auth Required |
|--------|------------|--------------------------|---------------|
| GET    | `/health`  | Health + DB status       | No            |

---

## WebSocket Events

### Client → Server

| Event                  | Payload             | Description                |
|------------------------|---------------------|----------------------------|
| `connection`           | -                   | Client connects            |
| `disconnect`           | -                   | Client disconnects         |

### Server → Client

| Event                  | Payload             | Description                |
|------------------------|---------------------|----------------------------|
| `message:new`          | `{message}`         | New SMS received           |
| `message:updated`      | `{message}`         | Message read/replied       |
| `settings:updated`     | `{enabled}`         | Messaging on/off changed   |

---

## Database Schema

### `messages` Table

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read BOOLEAN NOT NULL DEFAULT FALSE,
  replied BOOLEAN NOT NULL DEFAULT FALSE,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX idx_messages_read ON messages(read);
CREATE INDEX idx_messages_phone ON messages(phone);
```

### `settings` Table

```sql
CREATE TABLE settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES ('messaging_enabled', 'true');
```

### `session` Table

```sql
CREATE TABLE session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX idx_session_expire ON session(expire);
```

---

## Environment Variables

### Frontend (Vercel)

```bash
REACT_APP_API_URL=https://wyxr-texting-airroom.onrender.com
REACT_APP_LISTENER_PHONE=901-460-3031
```

### Backend (Render)

```bash
# Database (auto-provided by Render)
DATABASE_URL=postgresql://...

# Session
SESSION_SECRET=random-secret-key

# Authentication
AUTH_USERNAME=wyxr
AUTH_PASSWORD=secure-password

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+19014603031

# Server
NODE_ENV=production
PORT=10000

# CORS
FRONTEND_URL=https://wyxr-texting-airroom.vercel.app
```

---

## Security Architecture

### Authentication
- **Session-based auth** with PostgreSQL store
- **HttpOnly cookies** prevent XSS attacks
- **SameSite=none** with Secure flag for cross-origin
- **Trust proxy** for Render/Cloudflare

### CORS
- **Explicit origin** whitelist (Vercel URL only)
- **Credentials enabled** for cookie sharing
- **Exposed headers** for set-cookie

### Secrets Management
- **No secrets in code** - all in environment variables
- **Gitignored .env files** for local development
- **Platform-managed secrets** in Render/Vercel

### Input Validation
- **SQL injection protection** via parameterized queries
- **XSS protection** via React's built-in escaping
- **Rate limiting** via Twilio webhook validation

---

## Performance Considerations

### Frontend
- **Static hosting on CDN** (Vercel)
- **Code splitting** via React lazy loading
- **Asset optimization** via Create React App

### Backend
- **Connection pooling** for PostgreSQL
- **WebSocket multiplexing** via Socket.io
- **Session store** in database (not memory)

### Database
- **Indexed queries** on timestamp, read status, phone
- **12-hour display window** limits query size
- **Automatic cleanup** possible via cron (future)

---

## Deployment Pipeline

```
Developer
    │
    ├─► Push to GitHub main branch
    │
    ├─► Vercel detects commit
    │   ├─► Build frontend (npm run build)
    │   ├─► Run tests (if configured)
    │   └─► Deploy to CDN (~1-2 minutes)
    │
    └─► Render detects commit
        ├─► Build backend (npm install)
        ├─► Start server (npm start)
        └─► Deploy to container (~1-2 minutes)
```

---

## Monitoring & Logging

### Frontend (Vercel)
- **Build logs** in Vercel dashboard
- **Runtime logs** in browser console
- **Analytics** via Vercel Analytics (optional)

### Backend (Render)
- **Application logs** in Render dashboard
- **Database logs** in PostgreSQL service
- **SMS logs** in Twilio console

### Database (Render)
- **Query performance** via Render metrics
- **Connection stats** via pg_stat_activity
- **Storage usage** via Render dashboard

---

## Disaster Recovery

### Backup Strategy
- **Database**: Render automatic daily backups
- **Code**: GitHub version control
- **Environment variables**: Documented in CREDENTIALS.md

### Recovery Procedures
1. **Backend down**: Redeploy from Render dashboard
2. **Database corrupted**: Restore from Render backup
3. **Frontend down**: Redeploy from Vercel
4. **Credentials compromised**: Rotate via FEATURE_REQUESTS.md#Security

---

## Future Architecture Enhancements

### 1. Voice Message Integration
- Twilio Flex webhook → Backend
- Store recording URLs in database
- Display in message grid with audio player

### 2. Message Search & Analytics
- Elasticsearch for full-text search
- Redis for caching frequent queries
- Analytics dashboard with charts

### 3. Multi-Station Support
- Station table with branding config
- Station-scoped messages
- Station-specific routing

### 4. Mobile App
- React Native app
- Token-based auth (JWT)
- Push notifications via FCM

---

**Last Updated:** January 30, 2026

**Version:** 1.0.0

**Status:** Production - Deployed and operational
