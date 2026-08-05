-- Migration 006: Add broadcasts and broadcast_recipients tables
-- Purpose: Support one-to-many bulk SMS sends (station announcements, event
--          alerts, community updates) to listeners who opted in themselves.
--          Broadcasts are processed by a background worker rather than in the
--          request/response cycle, so a send survives process restarts and
--          Render free-tier spin-down. See BROADCAST_MESSAGING_SPEC.md.
-- Created: 2026-08-05

-- Broadcasts table - one row per bulk send (draft, in-flight, or finished)
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,                          -- staff-authored text, WITHOUT the compliance suffix
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, sending, completed, canceled
  created_by VARCHAR(100),                     -- admin session username
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,                    -- when staff clicked Confirm & Send
  started_at TIMESTAMPTZ,                      -- when the worker began processing
  completed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  canceled_by VARCHAR(100),
  recipient_count INTEGER NOT NULL DEFAULT 0,  -- snapshot taken at confirm time
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  character_count INTEGER,                     -- full outgoing text (body + suffix)
  segment_count INTEGER,
  encoding VARCHAR(10),                        -- 'GSM-7' or 'UCS-2'
  last_test_sent_at TIMESTAMPTZ,
  last_test_phone VARCHAR(20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Broadcast recipients - one row per (broadcast, phone). This is what makes a
-- send resumable and auditable, and what prevents double-texting a listener
-- if the worker restarts mid-broadcast.
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  opt_in_method VARCHAR(20),     -- 'sms' | 'web', snapshotted at confirm time so a
                                 -- complaint months later traces to its consent basis
                                 -- even if the contacts row has changed since.
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, sending, sent, failed_permanent, skipped
  twilio_sid VARCHAR(64),
  error_code VARCHAR(20),
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,        -- set when the worker picks the row up, before calling Twilio
  next_attempt_at TIMESTAMPTZ,   -- retry backoff scheduling
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_id, phone_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_id ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_worker_queue
  ON broadcast_recipients(broadcast_id, status, next_attempt_at);

-- Belt-and-suspenders: only one broadcast may be actively sending at a time.
-- The unique index is on a constant expression, so at most one row can satisfy
-- the WHERE clause. POST /admin/broadcasts/:id/confirm also enforces this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_one_active
  ON broadcasts ((1))
  WHERE status = 'sending';

-- Reuse existing update_updated_at_column() trigger function from migration 001
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_broadcasts_updated_at'
  ) THEN
    CREATE TRIGGER update_broadcasts_updated_at BEFORE UPDATE ON broadcasts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_broadcast_recipients_updated_at'
  ) THEN
    CREATE TRIGGER update_broadcast_recipients_updated_at BEFORE UPDATE ON broadcast_recipients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;
