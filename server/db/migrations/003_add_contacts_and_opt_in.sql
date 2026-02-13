-- Migration 003: Add contacts and opt_in_log tables
-- Purpose: Support web opt-in system for TCPA/A2P 10DLC compliance

-- Contacts table - tracks opt-in status for each phone number
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(50),
  opted_in BOOLEAN NOT NULL DEFAULT false,
  opt_in_method VARCHAR(20),
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
  action_type VARCHAR(50) NOT NULL,
  method VARCHAR(20),
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
