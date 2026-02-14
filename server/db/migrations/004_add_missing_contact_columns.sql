-- Migration 004: Add missing columns to contacts table (if they don't exist)
-- Purpose: Ensure contacts table has all required fields for web opt-in

-- Add first_name column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE contacts ADD COLUMN first_name VARCHAR(50);
  END IF;
END
$$;

-- Add created_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE contacts ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END
$$;

-- Add updated_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE contacts ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END
$$;

-- Add updated_at trigger if missing
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

-- Add ip_address, consent_text, source_url to opt_in_log if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opt_in_log' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE opt_in_log ADD COLUMN ip_address VARCHAR(45);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opt_in_log' AND column_name = 'consent_text'
  ) THEN
    ALTER TABLE opt_in_log ADD COLUMN consent_text TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opt_in_log' AND column_name = 'source_url'
  ) THEN
    ALTER TABLE opt_in_log ADD COLUMN source_url VARCHAR(255);
  END IF;
END
$$;

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contacts'
ORDER BY ordinal_position;
