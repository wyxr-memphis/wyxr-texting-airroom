# WYXR Listener Text App - Build Specification

## Overview
A real-time text messaging app for WYXR 91.7 FM radio DJs in the air room. Listeners text a dedicated number, messages appear instantly on the DJ's screen, and DJs can read them on-air or reply back.

## Core Features

### 1. Real-Time Message Display
- Messages appear instantly when listeners text in
- Show full phone number (e.g., 901-555-0123)
- Display timestamp for each message
- Visual distinction between read/unread messages
- Messages displayed in grid layout (optimized for desktop/horizontal screens)

### 2. Message Management
- Mark as Read / Mark as Unread toggle
- Reply to messages (marks as read automatically)
- Quick reply templates:
  - "Thanks for listening to WYXR!"
  - "We appreciate you tuning in!"
  - "Great request - I'll see what I can do!"
  - "Love hearing from Memphis listeners!"

### 3. Message Persistence
- All messages stored permanently in database
- Only messages from last 24 hours shown in UI
- Older messages hidden from display but kept in database

### 4. DJ Controls
- Power toggle to turn messaging on/off
- When off: shows "Messaging is currently off" state
- On-air instructions prominently displayed for DJs to read to listeners

### 5. Authentication
- Simple universal username/password
- Allows DJ in air room + staff monitoring from anywhere

## UI Design - WYXR Brand Colors

**Color Palette:**
- Yellow: #FFC629
- Pink: #E9407A  
- Blue: #2B9EB3
- Dark: #2B2B2B

**Layout:**
- Horizontal desktop-optimized design
- Header row with instructions (left) and power toggle (right)
- Message grid below (auto-fill columns, min 450px width each)
- Reply modal for responses

**Unread Messages:**
- Bright yellow background (#FFC629)
- Pink border (#E9407A)
- Pulsing indicator dot
- Bold text

**Read Messages:**
- Dim/subtle styling
- Show "Mark Unread" button

## Tech Stack

### Frontend
- React (similar to existing pledge drive dashboard)
- WebSocket connection for real-time updates
- Responsive design (desktop-first)

### Backend
- Node.js/Express
- Twilio for SMS (send/receive)
- WebSocket server (Socket.io)
- Simple authentication middleware

### Database
- PostgreSQL or MongoDB (your choice)
- Schema:
  ```
  messages {
    id: string
    phone: string (full number)
    text: string
    timestamp: datetime
    read: boolean
    replied: boolean
    replyText: string (optional)
    createdAt: datetime
  }
  ```

### SMS Integration - Twilio
- Dedicated phone number: TBD (set up in Twilio)
- Webhook endpoint for incoming messages
- API for sending replies
- Cost: ~$1/month for number + $0.0079 per message

## File Structure
```
wyxr-text-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── MessageFeed.jsx
│   │   │   ├── MessageCard.jsx
│   │   │   ├── ReplyModal.jsx
│   │   │   ├── PowerToggle.jsx
│   │   │   └── Header.jsx
│   │   ├── App.jsx
│   │   └── index.js
│   └── package.json
├── server/                 # Node backend
│   ├── routes/
│   │   ├── messages.js
│   │   └── auth.js
│   ├── services/
│   │   └── twilio.js
│   ├── db/
│   │   └── schema.js
│   ├── websocket.js
│   ├── server.js
│   └── package.json
└── README.md
```

## API Endpoints

### Messages
- `GET /api/messages` - Get messages from last 24 hours
- `POST /api/messages/:id/read` - Mark message as read/unread
- `POST /api/messages/:id/reply` - Send reply via Twilio

### Twilio Webhook
- `POST /webhook/sms` - Receive incoming texts from Twilio

### Auth
- `POST /api/login` - Simple username/password login
- `GET /api/verify` - Check if session is valid

## WebSocket Events

**Client → Server:**
- `message:read` - Mark message as read
- `message:unread` - Mark message as unread
- `message:reply` - Send reply

**Server → Client:**
- `message:new` - New message received
- `message:updated` - Message status changed
- `toggle:status` - Messaging on/off status

## Environment Variables
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
DATABASE_URL=
SESSION_SECRET=
PORT=3000
```

## Development Setup
1. Set up Twilio account and get phone number
2. Configure webhook URL to point to server
3. Set environment variables
4. Install dependencies (client + server)
5. Run database migrations
6. Start both client and server in dev mode

## Deployment Notes
- Deploy backend to Heroku/Railway/DigitalOcean
- Deploy frontend to Vercel/Netlify
- Ensure Twilio webhook points to production URL
- Set up SSL certificate (required for Twilio webhooks)

### Required Deployment Files

**Backend (Railway):**
- `railway.json` or `railway.toml` configuration
- `.env.example` with all required variables
- Database migration scripts
- Health check endpoint at `/health`

**Frontend (Vercel):**
- `vercel.json` configuration
- Environment variable for API URL
- Build command: `npm run build`
- Output directory: `build`

**Git Repository:**
- `.gitignore` excluding:
  - `node_modules/`
  - `.env`
  - `build/`
  - `dist/`
  - `.DS_Store`
- README with:
  - Local setup instructions
  - Deployment instructions
  - Environment variable documentation
  - Twilio webhook configuration steps

### Production Checklist
- [ ] Backend deployed to Railway with PostgreSQL
- [ ] Frontend deployed to Vercel
- [ ] Twilio webhook pointing to production backend
- [ ] Environment variables set in both platforms
- [ ] Database migrations run
- [ ] SSL certificate active (automatic with Railway/Vercel)
- [ ] Test end-to-end: text in → see in app → reply works
- [ ] Set up monitoring/logging (Railway provides this)

## Deployment Notes
- Deploy backend to Heroku/Railway/DigitalOcean
- Deploy frontend to Vercel/Netlify
- Ensure Twilio webhook points to production URL
- Set up SSL certificate (required for Twilio webhooks)

## Future Enhancements (Not in V1)
- Message filtering/moderation
- Analytics dashboard
- Multiple DJ accounts
- Message search/archive view
- SMS conversation threading

## Key Implementation Notes

### 24-Hour Display Window
Backend should filter messages by timestamp:
```javascript
const twentyFourHoursAgo = new Date(Date.now() - 24*60*60*1000);
const recentMessages = await db.messages.find({
  timestamp: { $gte: twentyFourHoursAgo }
});
```

### Twilio Incoming Webhook
```javascript
app.post('/webhook/sms', (req, res) => {
  const { From, Body } = req.body;
  
  // Save to database
  const message = await db.messages.create({
    phone: From,
    text: Body,
    timestamp: new Date(),
    read: false
  });
  
  // Broadcast to all connected clients via WebSocket
  io.emit('message:new', message);
  
  res.sendStatus(200);
});
```

### Reply via Twilio
```javascript
const twilio = require('twilio')(accountSid, authToken);

async function sendReply(to, message) {
  await twilio.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to
  });
}
```

## Success Criteria
- ✅ Messages appear within 2 seconds of text being sent
- ✅ UI is readable from 6-8 feet away (DJ at console)
- ✅ Works reliably during 2+ hour DJ shifts
- ✅ Simple enough for any DJ to use without training
- ✅ Staff can monitor from office/phone
- ✅ No messages lost even during high volume

## Reference Files
- See `wyxr-text-app-mockup.jsx` for complete UI mockup with all interactions
- WYXR brand colors from postcard: Yellow #FFC629, Pink #E9407A, Blue #2B9EB3
