# 🔐 Credentials - Private Information

**This file is for internal reference only. Do not share publicly.**

## Production Credentials

### Application Access
- **App URL:** https://wyxr-texting-airroom.vercel.app
- **Username:** wyxr
- **Password:** [Contact station management]

### Twilio
- **Phone Number:** [Contact station management]
- **Account SID:** [In Render environment variables]
- **Auth Token:** [In Render environment variables]

### Render.com
- **Backend URL:** https://wyxr-texting-airroom.onrender.com
- **Environment Variables:** [Access via Render dashboard]

### Vercel
- **Frontend URL:** https://wyxr-texting-airroom.vercel.app
- **Environment Variables:** [Access via Vercel dashboard]

## Security Notes

1. **Never commit actual credentials to Git**
   - Use `.env` files locally (gitignored)
   - Use platform environment variables in production

2. **Rotate credentials if exposed**
   - Change passwords immediately
   - Regenerate Twilio auth token
   - Update all deployment environment variables

3. **Access Control**
   - Only station management should have deployment access
   - DJs only need the app URL and login credentials

## Getting Credentials

Contact WYXR station management for access to:
- Application login credentials
- Text message phone number
- Render.com deployment dashboard
- Vercel deployment dashboard
- Twilio console access
