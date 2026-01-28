# Start WYXR Text App

## Quick Start

Your app is fully set up and ready to run!

### Start the Application

**Terminal 1 - Backend Server:**
```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom/server
npm run dev
```

**Terminal 2 - Frontend Client:**
```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom/client
npm start
```

The frontend will automatically open at: **http://localhost:3000**

### Login Credentials

- **Username**: `wyxr`
- **Password**: `wyxr2024`

⚠️ Change the password in `server/.env` before deploying to production!

## What's Working

✅ PostgreSQL database installed and running
✅ Database `wyxr_texts` created with schema
✅ Tables created: messages, settings, session
✅ Environment variables configured
✅ Dependencies installed (server + client)
✅ Default settings loaded (messaging enabled)

## Testing Without Twilio

The app will work fully for local testing without Twilio credentials:
- Login/logout works
- Message display works
- Read/unread toggling works
- Power toggle works
- Reply modal opens

Only SMS sending/receiving requires Twilio credentials.

## Adding Twilio (Optional)

To enable SMS features:

1. Sign up at https://console.twilio.com
2. Get a phone number
3. Copy credentials to `server/.env`:
   ```bash
   TWILIO_ACCOUNT_SID=your-actual-sid
   TWILIO_AUTH_TOKEN=your-actual-token
   TWILIO_PHONE_NUMBER=+1234567890
   ```
4. Restart the server

## Useful Commands

### Database
```bash
# Connect to database
psql wyxr_texts

# View tables
\dt

# View messages
SELECT * FROM messages;

# View settings
SELECT * FROM settings;

# Exit
\q
```

### PostgreSQL Service
```bash
# Check status
brew services list | grep postgresql

# Stop
brew services stop postgresql@14

# Start
brew services start postgresql@14

# Restart
brew services restart postgresql@14
```

### Development
```bash
# Install dependencies
npm run install-all

# Server only
cd server && npm run dev

# Client only
cd client && npm start

# Check what's running
lsof -i :3000  # Frontend
lsof -i :3001  # Backend
```

## Troubleshooting

### Port already in use
```bash
# Kill process on port 3001 (backend)
lsof -ti:3001 | xargs kill -9

# Kill process on port 3000 (frontend)
lsof -ti:3000 | xargs kill -9
```

### Database connection error
```bash
# Check PostgreSQL is running
brew services list | grep postgresql

# Restart if needed
brew services restart postgresql@14
```

### Changes not appearing
- Hard refresh browser: Cmd+Shift+R
- Clear React cache: `cd client && rm -rf node_modules/.cache`
- Restart both servers

## Next Steps

1. **Test locally**: Start both servers and test all features
2. **Customize**: Update login credentials and branding as needed
3. **Add Twilio**: Configure SMS when ready
4. **Deploy**: Follow deployment guide in README.md

## File Locations

- **Server code**: `/Users/robbygrant/scripts/wyxr-texting-airroom/server/`
- **Client code**: `/Users/robbygrant/scripts/wyxr-texting-airroom/client/`
- **Database schema**: `/Users/robbygrant/scripts/wyxr-texting-airroom/server/db/schema.sql`
- **Environment config**:
  - `server/.env`
  - `client/.env`

## Support

See documentation:
- **README.md** - Full documentation
- **SETUP.md** - Setup guide
- **DATABASE_SETUP.md** - Database instructions
- **IMPLEMENTATION_COMPLETE.md** - Feature summary

---

**Ready to start? Open two terminals and run the commands above!** 🚀
