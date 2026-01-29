# Deployment Checklist

Quick reference for deploying WYXR Text App to production.

## Pre-Deployment

- [ ] All features tested locally
- [ ] Code committed to git
- [ ] GitHub repository created
- [ ] Code pushed to GitHub

## Railway (Backend)

- [ ] Railway account created
- [ ] Project created from GitHub repo
- [ ] PostgreSQL database added
- [ ] Environment variables configured:
  - [ ] SESSION_SECRET
  - [ ] AUTH_USERNAME
  - [ ] AUTH_PASSWORD
  - [ ] TWILIO_ACCOUNT_SID
  - [ ] TWILIO_AUTH_TOKEN
  - [ ] TWILIO_PHONE_NUMBER
  - [ ] NODE_ENV=production
  - [ ] FRONTEND_URL (add after Vercel)
- [ ] Database migrations run
- [ ] Public domain generated
- [ ] Health check passes: `/health` returns `{"status":"ok"}`

**Railway Backend URL:** `_________________________________`

## Vercel (Frontend)

- [ ] Vercel account created
- [ ] Project imported from GitHub
- [ ] Root directory set to `client`
- [ ] Environment variable configured:
  - [ ] REACT_APP_API_URL (Railway backend URL)
- [ ] Deployment successful
- [ ] App loads in browser
- [ ] Login works

**Vercel Frontend URL:** `_________________________________`

## Railway Update

- [ ] Update FRONTEND_URL in Railway with Vercel URL
- [ ] Railway redeployed automatically

## Twilio Configuration

- [ ] Phone number: [WYXR Phone Number]
- [ ] Messaging webhook updated to Railway URL
- [ ] Webhook URL: `https://[railway-url]/webhook/sms`
- [ ] HTTP method: POST
- [ ] Test SMS received successfully

## Final Testing

- [ ] Send test SMS to [WYXR Phone Number]
- [ ] Message appears in production app
- [ ] Mark read/unread works
- [ ] Power toggle works
- [ ] Multiple browser windows sync
- [ ] Unread count updates correctly
- [ ] Reply modal opens (sending awaits A2P registration)

## Post-Deployment

- [ ] ngrok stopped (no longer needed)
- [ ] Local .env files remain secure (not in git)
- [ ] Monitor Railway logs for errors
- [ ] Monitor Vercel deployments
- [ ] Share app URL with team

## Notes

**Railway URL:**
**Vercel URL:**
**Twilio Webhook:**
**A2P Status:** Pending (1-2 weeks)

---

**See DEPLOYMENT_GUIDE.md for detailed instructions.**
