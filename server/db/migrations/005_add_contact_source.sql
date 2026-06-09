-- Add source column to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source VARCHAR(100);
