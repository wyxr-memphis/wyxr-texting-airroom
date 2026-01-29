#!/bin/bash

echo "🚂 Railway Database Migration"
echo "=============================="
echo ""
echo "This will run the database schema on your Railway PostgreSQL database."
echo ""
echo "You need the DATABASE_URL from Railway:"
echo "  1. Go to Railway → PostgreSQL service → Variables tab"
echo "  2. Copy the DATABASE_URL value"
echo ""
read -p "Paste DATABASE_URL here: " DATABASE_URL
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
else
    echo ""
    echo "❌ Migration failed. Check the error above."
    exit 1
fi
