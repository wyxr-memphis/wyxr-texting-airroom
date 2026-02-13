#!/bin/bash

echo "🎨 Run Specific Migration on Render"
echo "===================================="
echo ""
echo "This will run migration 003_add_contacts_and_opt_in.sql on your Render database."
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

echo "Running migration: 003_add_contacts_and_opt_in.sql"
echo ""
psql "$DATABASE_URL" < server/db/migrations/003_add_contacts_and_opt_in.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration successful!"
    echo ""
    echo "Verifying new tables..."
    psql "$DATABASE_URL" -c "\dt"
    echo ""
    echo "🎉 Contacts and opt_in_log tables created!"
else
    echo ""
    echo "❌ Migration failed. Check the error above."
    exit 1
fi
