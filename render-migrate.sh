#!/bin/bash

echo "🎨 Render Database Migration"
echo "============================"
echo ""
echo "This will run the database schema on your Render PostgreSQL database."
echo ""
echo "You need the External Database URL from Render:"
echo "  1. Go to Render → Your PostgreSQL database → Connect"
echo "  2. Open the 'External' tab (the Internal URL only works inside Render)"
echo "  3. Copy the full URL (postgresql://...render.com/...)"
echo ""
read -p "Paste External Database URL here: " DATABASE_URL
echo ""

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL is empty. Please try again."
    exit 1
fi

echo "Running migration..."
psql "$DATABASE_URL" < server/db/schema.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration successful!"
    echo ""
    echo "Verifying tables..."
    psql "$DATABASE_URL" -c "\dt"
    echo ""
    echo "🎉 Database ready!"
else
    echo ""
    echo "❌ Migration failed. Check the error above."
    exit 1
fi
