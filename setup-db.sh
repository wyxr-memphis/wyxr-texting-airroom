#!/bin/bash

# WYXR Text App Database Setup Script

echo "🎵 WYXR Text App - Database Setup"
echo "=================================="
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed or not in PATH"
    echo ""
    echo "Please install PostgreSQL first:"
    echo "  • macOS: brew install postgresql@14"
    echo "  • Or download Postgres.app from https://postgresapp.com"
    echo "  • Or use Docker (see DATABASE_SETUP.md)"
    echo ""
    echo "For detailed instructions, see: DATABASE_SETUP.md"
    exit 1
fi

echo "✅ PostgreSQL found: $(psql --version)"
echo ""

# Check if database exists
if psql -lqt | cut -d \| -f 1 | grep -qw wyxr_texts; then
    echo "⚠️  Database 'wyxr_texts' already exists"
    read -p "Do you want to drop and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Dropping existing database..."
        dropdb wyxr_texts
    else
        echo "Keeping existing database..."
    fi
fi

# Create database if it doesn't exist
if ! psql -lqt | cut -d \| -f 1 | grep -qw wyxr_texts; then
    echo "Creating database 'wyxr_texts'..."
    createdb wyxr_texts

    if [ $? -eq 0 ]; then
        echo "✅ Database created successfully"
    else
        echo "❌ Failed to create database"
        exit 1
    fi
else
    echo "✅ Database 'wyxr_texts' exists"
fi

echo ""
echo "Loading database schema..."
psql wyxr_texts < server/db/schema.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Database schema loaded successfully"
    echo ""
    echo "Verifying tables..."
    psql wyxr_texts -c "\dt"
    echo ""
    echo "Checking default settings..."
    psql wyxr_texts -c "SELECT * FROM settings;"
    echo ""
    echo "🎉 Database setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Update Twilio credentials in server/.env"
    echo "  2. Change default password in server/.env"
    echo "  3. Start the server: cd server && npm run dev"
    echo "  4. Start the client: cd client && npm start"
else
    echo "❌ Failed to load database schema"
    exit 1
fi
