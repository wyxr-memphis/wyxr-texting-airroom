#!/bin/bash

echo "🚇 Starting ngrok tunnel to localhost:3001"
echo "=========================================="
echo ""
echo "This will expose your local server to the internet so Twilio can send webhooks."
echo ""
echo "Keep this terminal window open while testing SMS features!"
echo ""
echo "Press Ctrl+C to stop ngrok when done."
echo ""
echo "Starting in 3 seconds..."
sleep 3

ngrok http 3001
