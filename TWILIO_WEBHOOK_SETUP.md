# Twilio Webhook Setup for Local Development

## The Problem

Your test message was received by Twilio, but the delivery steps show:
> **"There were no HTTP Requests logged for this event."**

This means Twilio doesn't know where to send incoming SMS messages to your app.

## The Solution

We need to configure a webhook URL in Twilio that points to your local server. Since your server runs on `localhost:3001`, we'll use **ngrok** to create a public URL that tunnels to your local machine.

---

## Step-by-Step Setup

### Step 1: Start Your Server (If Not Running)

Make sure your backend server is running:

```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom/server
npm run dev
```

You should see:
```
Server running on port 3001
```

### Step 2: Start ngrok Tunnel

Open a **new terminal window** (Terminal 3) and run:

```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom
./start-ngrok.sh
```

Or manually:
```bash
ngrok http 3001
```

You'll see output like this:
```
ngrok

Session Status                online
Account                       [your account]
Version                       3.35.0
Region                        United States (us)
Latency                       -
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://a1b2c3d4.ngrok-free.app -> http://localhost:3001

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

**Important:** Copy the `Forwarding` HTTPS URL. In this example: `https://a1b2c3d4.ngrok-free.app`

**Keep this terminal window open!** Closing it will stop the tunnel.

### Step 3: Configure Twilio Webhook

1. **Go to Twilio Console:**
   - Visit: https://console.twilio.com/
   - Navigate to: **Phone Numbers** → **Manage** → **Active numbers**

2. **Click on your WYXR phone number** (+1 9013909664)

3. **Scroll down to "Messaging Configuration"**

4. **Find "A MESSAGE COMES IN" section:**
   - Change from "TwiML Bin" or blank to **Webhook**
   - Set URL to: `https://YOUR-NGROK-URL.ngrok-free.app/webhook/sms`
   - Example: `https://a1b2c3d4.ngrok-free.app/webhook/sms`
   - HTTP Method: **POST**

5. **Click "Save" at the bottom**

### Step 4: Test SMS Flow

1. Send a text message to your Twilio number from your phone
2. Check your server terminal - you should see:
   ```
   Incoming SMS: { from: '+19018304788', body: 'Hi. I love the station!' }
   ```
3. Check your app at http://localhost:3000
4. The message should appear instantly in the message feed!

### Step 5: Verify in Twilio Console

1. Go back to Twilio Console → Monitor → Logs → Messaging
2. Click on your test message
3. Under "Delivery Steps" you should now see:
   - ✅ **HTTP POST request to your webhook URL**
   - ✅ **Response: 200 OK**

---

## Ngrok Web Interface

While ngrok is running, you can view detailed request logs at:
- http://localhost:4040

This shows all HTTP requests going through the tunnel in real-time!

---

## Terminal Setup for Local Development

You'll need **3 terminal windows** running simultaneously:

### Terminal 1: Backend Server
```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom/server
npm run dev
```

### Terminal 2: Frontend Client
```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom/client
npm start
```

### Terminal 3: ngrok Tunnel
```bash
cd /Users/robbygrant/scripts/wyxr-texting-airroom
./start-ngrok.sh
```

---

## Important Notes

### ngrok URL Changes
⚠️ **Every time you restart ngrok, you get a NEW URL!**

You'll need to update the Twilio webhook URL each time you restart ngrok.

**Tip:** Keep ngrok running in the background during your entire development session.

### ngrok Free Tier Limitations
- URL changes on restart
- Session timeout after 2 hours (reconnects automatically)
- Rate limits apply

For a permanent URL, sign up for ngrok's paid plan or use a cloud deployment.

### Production Deployment
When you deploy to Railway/Vercel, you'll have a permanent URL:
```
https://wyxr-backend.up.railway.app/webhook/sms
```

Then you won't need ngrok anymore!

---

## Troubleshooting

### "Command not found: ngrok"
```bash
brew install ngrok/ngrok/ngrok
```

### "ERR_NGROK_108: ngrok gateway error"
ngrok is having connectivity issues. Try:
```bash
ngrok config check
ngrok http 3001 --log stdout
```

### Webhook returns 404 or 500
- Check your server is running on port 3001
- Verify the webhook URL ends with `/webhook/sms`
- Check server logs for errors

### Message received but not in app
1. Check browser console for WebSocket errors
2. Verify you're logged in
3. Check server terminal for error messages
4. Refresh the page

### ngrok shows 502 Bad Gateway
Your server isn't running or crashed. Check Terminal 1.

---

## Quick Commands

```bash
# Start everything
cd server && npm run dev                    # Terminal 1
cd client && npm start                      # Terminal 2
./start-ngrok.sh                            # Terminal 3

# Check ngrok status
curl http://localhost:4040/api/tunnels

# Get current ngrok URL
curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*ngrok[^"]*'

# Stop ngrok
# Press Ctrl+C in the ngrok terminal
```

---

## Next Steps

1. ✅ Start ngrok tunnel
2. ✅ Copy the HTTPS URL
3. ✅ Configure Twilio webhook
4. ✅ Send test SMS
5. ✅ Watch it appear in your app!

Once you see messages flowing through, try:
- Clicking a message to mark it read/unread
- Clicking the phone number to open reply modal
- Sending a reply (the sender will receive an SMS!)
- Using quick reply templates

---

## Production Setup

When you're ready to deploy:

1. Deploy backend to Railway → Get permanent URL
2. Update Twilio webhook to Railway URL
3. No more ngrok needed!

See README.md for full deployment instructions.
