-- Migration 003: Add contacts and opt_in_log tables
-- Purpose: Support SMS/web opt-in system for TCPA/A2P 10DLC compliance
-- Created: 2026-02-13

-- Contacts table - tracks opt-in status for each phone number
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(50),
  opted_in BOOLEAN NOT NULL DEFAULT false,
  opt_in_method VARCHAR(20), -- 'sms', 'web', 'legacy'
  opt_in_timestamp TIMESTAMPTZ,
  pending_message TEXT,
  pending_timestamp TIMESTAMPTZ,
  first_contact_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_timestamp TIMESTAMPTZ,
  opted_out BOOLEAN NOT NULL DEFAULT false,
  opted_out_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Opt-in log table - audit trail for all opt-in/opt-out actions
CREATE TABLE IF NOT EXISTS opt_in_log (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- 'request', 'confirm', 'reminder', 'opt_out', etc.
  method VARCHAR(20), -- 'sms', 'web'
  user_message TEXT,
  system_response TEXT,
  ip_address VARCHAR(45),
  consent_text TEXT,
  source_url VARCHAR(255),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_opted_in ON contacts(opted_in);
CREATE INDEX IF NOT EXISTS idx_opt_in_log_phone ON opt_in_log(phone_number);
CREATE INDEX IF NOT EXISTS idx_opt_in_log_timestamp ON opt_in_log(timestamp);

-- Reuse existing update_updated_at_column() trigger function from migration 001
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_contacts_updated_at'
  ) THEN
    CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;

-- Backfill legacy contacts from existing messages
-- Mark all existing phone numbers as opted-in with method='legacy'
INSERT INTO contacts (phone_number, opted_in, opt_in_method, opt_in_timestamp, first_contact_timestamp)
SELECT DISTINCT
  phone,
  true,
  'legacy',
  MIN(timestamp),
  MIN(timestamp)
FROM messages
WHERE phone NOT IN (SELECT phone_number FROM contacts)
GROUP BY phone
ON CONFLICT (phone_number) DO NOTHING;

-- Log the legacy migration
INSERT INTO opt_in_log (phone_number, action_type, method, system_response)
SELECT phone_number, 'legacy_migration', 'system', 'Backfilled from existing messages table'
FROM contacts
WHERE opt_in_method = 'legacy';
