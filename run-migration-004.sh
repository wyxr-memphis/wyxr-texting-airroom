#!/bin/bash

echo "🔧 Fix Contacts Table Schema"
echo "============================"
echo ""
echo "This will safely add missing columns to the contacts table."
echo ""
echo "You need the External Database URL from Render:"
echo "  1. Go to Render → Your PostgreSQL database → Info tab"
echo "  2. Copy 'External Database URL' (postgres://...)"
echo "  3. Paste below"
echo ""
read -p "Paste External Database URL here: " DATABASE_URL
echo ""

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL is empty. Please try again."
    exit 1
fi

echo "Running migration: 004_add_missing_contact_columns.sql"
echo ""
psql "$DATABASE_URL" < server/db/migrations/004_add_missing_contact_columns.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration successful!"
    echo ""
    echo "Verifying contacts table columns..."
    psql "$DATABASE_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'contacts' ORDER BY ordinal_position;"
    echo ""
    echo "🎉 Contacts table updated!"
else
    echo ""
    echo "❌ Migration failed. Check the error above."
    exit 1
fi
