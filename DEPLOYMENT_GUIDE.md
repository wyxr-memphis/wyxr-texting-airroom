# WYXR Text App - Production Deployment Guide

Complete guide for deploying to Railway (backend) and Vercel (frontend).

---

## Prerequisites

- [x] GitHub account
- [x] Code pushed to GitHub repository
- [ ] Railway account (sign up at https://railway.app)
- [ ] Vercel account (sign up at https://vercel.com)
- [x] Twilio account with credentials

---

## Part 1: Deploy Backend to Railway

### Step 1: Create Railway Account

1. Go to https://railway.app
2. Sign up with GitHub
3. Authorize Railway to access your repositories

### Step 2: Create New Project

1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose your repository: `wyxr-text-app`
4. Railway will detect it's a Node.js project

### Step 3: Add PostgreSQL Database

1. In your Railway project dashboard
2. Click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
3. Railway automatically creates `DATABASE_URL` variable
4. The database will be linked to your app

### Step 4: Configure Environment Variables

1. Click on your service (not the database)
2. Go to **"Variables"** tab
3. Add these variables (click "+ New Variable" for each):

```
SESSION_SECRET=<generate-new-one>
AUTH_USERNAME=wyxr
AUTH_PASSWORD=<your-secure-password>
TWILIO_ACCOUNT_SID=<from-twilio-console>
TWILIO_AUTH_TOKEN=<from-twilio-console>
TWILIO_PHONE_NUMBER=[WYXR_PHONE]
NODE_ENV=production
PORT=3001
FRONTEND_URL=<will-add-after-vercel-deployment>
```

**Generate SESSION_SECRET:**
```bash
openssl rand -base64 32
```

**Note:** `DATABASE_URL` is automatically set by Railway when you add PostgreSQL.

### Step 5: Configure Build Settings

Railway should auto-detect from `railway.json`, but verify:

1. **Build Command**: `cd server && npm install`
2. **Start Command**: `cd server && npm start`
3. **Root Directory**: Leave empty (uses project root)

### Step 6: Deploy

1. Click **"Deploy"**
2. Wait for build to complete (2-3 minutes)
3. Check deployment logs for errors

### Step 7: Run Database Migration

Once deployed:

1. In Railway dashboard, click on **PostgreSQL database**
2. Go to **"Data"** tab
3. Click **"Query"** (or use the connection string with local psql)
4. Copy and paste contents of `server/db/schema.sql`
5. Execute the query

**Or use Railway CLI:**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Run migration
railway run psql $DATABASE_URL < server/db/schema.sql
```

### Step 8: Get Backend URL

1. In Railway project, click on your service
2. Go to **"Settings"** tab
3. Scroll to **"Networking"** → **"Public Networking"**
4. Click **"Generate Domain"**
5. Copy the URL (e.g., `https://wyxr-backend-production.up.railway.app`)

**Save this URL** - you'll need it for Vercel and Twilio!

### Step 9: Test Backend

Visit your backend URL + `/health`:
```
https://your-backend-url.up.railway.app/health
```

Should return:
```json
{"status":"ok","database":"connected"}
```

---

## Part 2: Deploy Frontend to Vercel

### Step 1: Create Vercel Account

1. Go to https://vercel.com
2. Sign up with GitHub
3. Authorize Vercel to access repositories

### Step 2: Import Project

1. Click **"Add New..."** → **"Project"**
2. Import your repository: `wyxr-text-app`
3. Click **"Import"**

### Step 3: Configure Build Settings

**IMPORTANT:** Set the root directory!

1. **Framework Preset**: Create React App (should auto-detect)
2. **Root Directory**: `client` ← **CRITICAL!**
3. **Build Command**: `npm run build` (default)
4. **Output Directory**: `build` (default)
5. **Install Command**: `npm install` (default)

### Step 4: Configure Environment Variables

Before deploying, add environment variables:

1. Expand **"Environment Variables"** section
2. Add variable:
   - **Name**: `REACT_APP_API_URL`
   - **Value**: `https://your-railway-backend-url.up.railway.app`
   - (Use the Railway URL from Part 1, Step 8)

### Step 5: Deploy

1. Click **"Deploy"**
2. Wait for build (2-3 minutes)
3. Vercel will show you the live URL

### Step 6: Get Frontend URL

After deployment:
- Vercel shows your URL (e.g., `https://wyxr-text-app.vercel.app`)
- **Copy this URL**

### Step 7: Update Railway FRONTEND_URL

Go back to Railway:
1. Open your backend service
2. Go to **"Variables"** tab
3. Find `FRONTEND_URL` variable
4. Update to your Vercel URL: `https://wyxr-text-app.vercel.app`
5. Save (Railway will redeploy automatically)

### Step 8: Test Frontend

1. Visit your Vercel URL
2. Should see login page
3. Login with your credentials
4. Should load (no messages yet - webhook not configured)

---

## Part 3: Configure Twilio for Production

### Update SMS Webhook

1. Go to Twilio Console: https://console.twilio.com/
2. Navigate to: **Phone Numbers** → **Manage** → **Active numbers**
3. Click on: **[WYXR Phone Number]**
4. Scroll to **"Messaging Configuration"**
5. Under **"A message comes in"**:
   - Type: **Webhook**
   - URL: `https://your-railway-backend-url.up.railway.app/webhook/sms`
   - Method: **POST**
6. Click **"Save"**

**You can now close ngrok!** No longer needed in production.

---

## Part 4: Test Production Deployment

### Test Incoming SMS

1. Send a text to: [WYXR Phone Number]
2. Check Railway logs (should see "Incoming SMS")
3. Open your Vercel app
4. Login
5. Message should appear instantly!

### Test All Features

- [ ] Login works
- [ ] Messages appear in real-time
- [ ] Mark read/unread works
- [ ] Unread count updates
- [ ] Power toggle works
- [ ] Reply modal opens
- [ ] Multiple browser windows sync
- [ ] SMS receiving works
- [ ] (SMS sending will work once A2P registration completes)

---

## Part 5: Post-Deployment Configuration

### Custom Domain (Optional)

**Railway (Backend):**
1. Railway dashboard → Service → Settings → Networking
2. Add custom domain (e.g., `api.wyxr.org`)
3. Add DNS records as shown

**Vercel (Frontend):**
1. Vercel dashboard → Project → Settings → Domains
2. Add custom domain (e.g., `texts.wyxr.org`)
3. Add DNS records as shown

If you add custom domains:
- Update `FRONTEND_URL` in Railway
- Update `REACT_APP_API_URL` in Vercel
- Update Twilio webhook URL

### Environment Variables Security

**Never commit these to git:**
- `.env` files are in `.gitignore` ✅
- All secrets in Railway/Vercel variables ✅
- Twilio credentials secure ✅

### A2P Registration Completion

Once A2P registration is approved:
1. No changes needed!
2. SMS replies will automatically start working
3. Test by replying to a message

---

## Monitoring & Maintenance

### Railway Monitoring

- **Logs**: Railway dashboard → Service → Deployments → View logs
- **Metrics**: CPU, memory, network usage
- **Restart**: Settings → Restart

### Vercel Monitoring

- **Logs**: Vercel dashboard → Project → Deployments
- **Analytics**: Track page views, performance
- **Redeploy**: Deployments → Click "..." → Redeploy

### Database Backups

Railway PostgreSQL includes automatic backups:
- Dashboard → Database → Backups
- Can restore to any point in time

### Cost Estimates

**Railway (Hobby Plan):**
- $5/month for resources
- Includes PostgreSQL database
- 500 hours/month execution time

**Vercel (Hobby Plan):**
- Free for personal projects
- 100GB bandwidth/month
- Unlimited deployments

**Twilio:**
- $1.15/month per phone number
- $0.0079 per SMS received
- $0.0079 per SMS sent (after A2P registration)
- A2P registration: ~$4/month

**Total:** ~$10-15/month

---

## Troubleshooting

### Backend issues

**Can't connect to database:**
- Check `DATABASE_URL` is set in Railway
- Verify migrations ran successfully
- Check Railway logs for errors

**Health check fails:**
- Railway → Service → Settings → Check if service is running
- View deployment logs
- Verify environment variables are set

### Frontend issues

**Can't connect to backend:**
- Verify `REACT_APP_API_URL` is correct
- Check CORS settings in backend
- Open browser console for error messages

**Build fails:**
- Check root directory is set to `client`
- Verify all dependencies in package.json
- Check Vercel build logs

### SMS not working

**Not receiving:**
- Verify Twilio webhook points to Railway URL
- Check Railway logs for incoming webhooks
- Test webhook URL manually: `curl -X POST your-url/webhook/sms`

**Can't send replies:**
- Wait for A2P registration to complete
- Check Twilio account status
- Verify `TWILIO_*` variables are correct

### WebSocket issues

**Real-time updates not working:**
- Check `FRONTEND_URL` in Railway matches Vercel URL
- Verify CORS settings
- Check browser console for WebSocket errors
- Railway might need to enable WebSocket support (usually automatic)

---

## Rollback Procedure

### Railway Rollback

1. Dashboard → Service → Deployments
2. Find previous working deployment
3. Click "..." → "Redeploy"

### Vercel Rollback

1. Dashboard → Project → Deployments
2. Find previous working deployment
3. Click "..." → "Promote to Production"

---

## Next Steps After Deployment

1. ✅ Test all features in production
2. ⏳ Wait for A2P registration (1-2 weeks)
3. 🎨 Customize quick reply templates
4. 📱 Train DJs on how to use the app
5. 📊 Monitor usage and costs
6. 🔒 Consider custom domains
7. 📈 Set up monitoring/alerts (optional)

---

## Support Resources

- **Railway Docs**: https://docs.railway.app
- **Vercel Docs**: https://vercel.com/docs
- **Twilio Docs**: https://www.twilio.com/docs
- **Project README**: See README.md in repository

---

**You're ready to deploy!** Follow the steps above in order.
