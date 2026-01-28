# Quick Setup Guide

## First Time Setup

### 1. Install Dependencies

```bash
# Install all dependencies at once
npm run install-all

# Or install separately
cd server && npm install
cd ../client && npm install
```

### 2. Create PostgreSQL Database

```bash
# Using createdb command
createdb wyxr_texts

# Or using psql
psql -c "CREATE DATABASE wyxr_texts;"
```

### 3. Run Database Migrations

```bash
# Option 1: Using psql
psql wyxr_texts < server/db/schema.sql

# Option 2: Using full path
psql -d wyxr_texts -f server/db/schema.sql

# Option 3: Using DATABASE_URL
psql postgresql://localhost:5432/wyxr_texts < server/db/schema.sql
```

### 4. Configure Server Environment

Copy and edit server environment file:

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set:
- `DATABASE_URL` - Your PostgreSQL connection string
- `SESSION_SECRET` - Random string (generate with: `openssl rand -base64 32`)
- `AUTH_USERNAME` and `AUTH_PASSWORD` - Login credentials
- Twilio credentials (get from twilio.com/console)

### 5. Configure Client Environment

Copy and edit client environment file:

```bash
cp client/.env.example client/.env
```

Edit `client/.env`:
- `REACT_APP_API_URL=http://localhost:3001`

### 6. Start Development Servers

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd client
npm start
```

Frontend will open at: `http://localhost:3000`
Backend API at: `http://localhost:3001`

### 7. Test Local Setup

1. Open `http://localhost:3000`
2. Login with credentials from `.env`
3. Check health endpoint: `http://localhost:3001/health`

### 8. Setup Twilio Webhook (Optional for SMS)

For local SMS testing:

```bash
# Install ngrok
npm install -g ngrok

# Start ngrok
ngrok http 3001
```

Copy the HTTPS URL and set in Twilio Console:
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/webhook/sms`
- HTTP Method: POST

## Troubleshooting

### Database connection error
```bash
# Check PostgreSQL is running
pg_isready

# Test connection
psql wyxr_texts -c "SELECT 1;"
```

### Port already in use
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Node modules issues
```bash
# Clear and reinstall
cd server && rm -rf node_modules package-lock.json && npm install
cd ../client && rm -rf node_modules package-lock.json && npm install
```

## Production Deployment Checklist

- [ ] PostgreSQL database provisioned
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Backend deployed and health check passing
- [ ] Frontend deployed
- [ ] CORS configured with correct frontend URL
- [ ] Twilio webhook pointing to production backend
- [ ] Test end-to-end SMS flow
- [ ] Monitor logs for errors

## Quick Commands

```bash
# Install everything
npm run install-all

# Start backend only
npm run server

# Start frontend only
npm run client

# Reset database (CAUTION: Deletes all data)
psql wyxr_texts < server/db/schema.sql

# View backend logs (if running in background)
tail -f server/logs/app.log

# Check what's running on ports
lsof -i :3000
lsof -i :3001
```

## Environment Variables Quick Reference

### Server (.env)
```
DATABASE_URL=postgresql://localhost:5432/wyxr_texts
SESSION_SECRET=<random-string>
AUTH_USERNAME=wyxr
AUTH_PASSWORD=<secure-password>
TWILIO_ACCOUNT_SID=<from-twilio>
TWILIO_AUTH_TOKEN=<from-twilio>
TWILIO_PHONE_NUMBER=<from-twilio>
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### Client (.env)
```
REACT_APP_API_URL=http://localhost:3001
```

## Next Steps

1. Customize authentication credentials
2. Configure Twilio for SMS
3. Test all features locally
4. Deploy to production (see README.md)
5. Configure production Twilio webhook

## Support

See README.md for detailed documentation and troubleshooting.
