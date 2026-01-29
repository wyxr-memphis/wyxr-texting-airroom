# Database Setup Instructions

PostgreSQL is not currently installed on your system. Follow these steps to install and set up the database.

## Step 1: Install PostgreSQL

### Option A: Using Homebrew (Recommended for macOS)
```bash
# Install PostgreSQL
brew install postgresql@14

# Start PostgreSQL service
brew services start postgresql@14

# Add to PATH
echo 'export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Option B: Using Postgres.app (GUI for macOS)
1. Download from: https://postgresapp.com/
2. Install and launch Postgres.app
3. Click "Initialize" to create a new server
4. Add to PATH:
   ```bash
   sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
   ```

### Option C: Docker (Cross-platform)
```bash
# Run PostgreSQL in Docker
docker run --name wyxr-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=wyxr_texts \
  -p 5432:5432 \
  -d postgres:14

# Update server/.env DATABASE_URL to:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wyxr_texts
```

## Step 2: Create Database

After PostgreSQL is installed and running:

```bash
# Create the database
createdb wyxr_texts

# Or if you set a password:
createdb -U postgres wyxr_texts
```

## Step 3: Run Database Schema

```bash
# Navigate to project root
cd /Users/robbygrant/scripts/wyxr-texting-airroom

# Run the schema
psql wyxr_texts < server/db/schema.sql

# Or if you need to specify user:
psql -U postgres wyxr_texts < server/db/schema.sql
```

## Step 4: Verify Database Setup

```bash
# Connect to database
psql wyxr_texts

# Check tables (you should see: messages, settings, session)
\dt

# Check settings table
SELECT * FROM settings;

# Exit
\q
```

## Troubleshooting

### "createdb: command not found"
PostgreSQL is not in your PATH. Try:
```bash
# Find PostgreSQL
which psql

# If not found, check if installed:
brew list postgresql@14

# If installed, add to PATH
export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"
```

### "connection refused" or "could not connect to server"
PostgreSQL service is not running:
```bash
# Check if running
brew services list | grep postgresql

# Start it
brew services start postgresql@14

# Or for Postgres.app, launch the app
```

### "database already exists"
If you need to recreate:
```bash
dropdb wyxr_texts
createdb wyxr_texts
psql wyxr_texts < server/db/schema.sql
```

### "permission denied"
Try with postgres user:
```bash
createdb -U postgres wyxr_texts
psql -U postgres wyxr_texts < server/db/schema.sql
```

## Alternative: Using Docker Compose

Create `docker-compose.yml` in project root:

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: wyxr_texts
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Then run:
```bash
docker-compose up -d
psql -U postgres -h localhost wyxr_texts < server/db/schema.sql
```

## Next Steps

Once database is set up:

1. ✅ Environment variables are configured (server/.env and client/.env)
2. ✅ Database created and schema loaded
3. Start the application:

```bash
# Terminal 1 - Backend
cd server && npm run dev

# Terminal 2 - Frontend
cd client && npm start
```

4. Open http://localhost:3000
5. Login with:
   - Username: `wyxr`
   - Password: `[PASSWORD]`

## Current Configuration

Your environment files have been created:

**server/.env**
- Database: `postgresql://localhost:5432/wyxr_texts`
- Session secret: Generated securely
- Auth username: `wyxr`
- Auth password: `[PASSWORD]` (CHANGE THIS!)
- Twilio: Placeholder values (update when ready)

**client/.env**
- API URL: `http://localhost:3001`

## Security Notes

⚠️ **IMPORTANT**: The default password is `[PASSWORD]`. Change this in `server/.env` before deploying to production!

To generate a new session secret:
```bash
openssl rand -base64 32
```
