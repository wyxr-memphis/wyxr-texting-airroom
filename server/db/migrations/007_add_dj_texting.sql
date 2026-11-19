-- Migration 007: DJ texting group
-- Purpose: A second broadcast audience (station DJs) sent from a second Twilio
--          number, kept fully apart from listener contacts. DJ replies are
--          relayed to a private staff Slack channel and staff answers are
--          texted back from the DJ number. See DJ_TEXTING.md.
-- Created: 2026-11-18
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS or a DO-block
-- check, matching migration 006.

-- DJ roster - staff-managed list of DJs. Never mixed with contacts.
CREATE TABLE IF NOT EXISTS dj_roster (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,      -- E.164
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  name_requested_at TIMESTAMPTZ,                 -- set while the app is waiting for the DJ to text their name
  name_request_count INTEGER NOT NULL DEFAULT 0, -- capped at 3 asks
  show_name VARCHAR(200),
  active BOOLEAN NOT NULL DEFAULT true,          -- false = removed by staff (never deleted)
  opt_in_requested_at TIMESTAMPTZ,               -- DJ texted the keyword DJ; waiting on YES
  opted_in BOOLEAN NOT NULL DEFAULT false,
  opt_in_method VARCHAR(20),                     -- 'sms_keyword'
  opt_in_timestamp TIMESTAMPTZ,
  opted_out BOOLEAN NOT NULL DEFAULT false,
  opted_out_timestamp TIMESTAMPTZ,
  added_by VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DJ consent audit log - same shape as opt_in_log, separate table.
CREATE TABLE IF NOT EXISTS dj_consent_log (
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

-- Texts DJs send to the DJ line (replies, name answers).
CREATE TABLE IF NOT EXISTS dj_inbound_messages (
  id SERIAL PRIMARY KEY,
  dj_id INTEGER REFERENCES dj_roster(id),
  phone_number VARCHAR(20) NOT NULL,
  body TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read BOOLEAN NOT NULL DEFAULT false,
  slack_ts VARCHAR(32),
  slack_thread_ts VARCHAR(32)
);

-- One Slack thread per DJ (a new one starts after DJ_SLACK_THREAD_DAYS idle).
CREATE TABLE IF NOT EXISTS dj_slack_threads (
  id SERIAL PRIMARY KEY,
  dj_id INTEGER NOT NULL REFERENCES dj_roster(id),
  channel_id VARCHAR(32) NOT NULL,
  thread_ts VARCHAR(32) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff answers typed in a DJ's Slack thread. slack_ts is UNIQUE so a Slack
-- retry of the same event can never text the DJ twice. status is NULL while
-- the send is in progress.
CREATE TABLE IF NOT EXISTS dj_outbound_replies (
  id SERIAL PRIMARY KEY,
  dj_id INTEGER REFERENCES dj_roster(id),
  slack_thread_ts VARCHAR(32),
  slack_ts VARCHAR(32) UNIQUE NOT NULL,
  slack_user_id VARCHAR(32),
  body TEXT,
  twilio_sid VARCHAR(64),
  status VARCHAR(20) CHECK (status IN ('sent', 'skipped', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dj_consent_log_phone ON dj_consent_log(phone_number, timestamp);
CREATE INDEX IF NOT EXISTS idx_dj_inbound_messages_received ON dj_inbound_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_dj_slack_threads_dj ON dj_slack_threads(dj_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_dj_outbound_replies_created ON dj_outbound_replies(created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_dj_roster_updated_at'
  ) THEN
    CREATE TRIGGER update_dj_roster_updated_at BEFORE UPDATE ON dj_roster
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;

-- Broadcasts: which audience, and which number it is sent from.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'listeners';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS from_number VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_audience_check'
  ) THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_audience_check CHECK (audience IN ('listeners', 'djs'));
  END IF;
END
$$;

-- One sending broadcast per audience (was: one overall), so a DJ notice is
-- never blocked by the existence of a listener send, while the worker still
-- sends one text at a time across both.
DROP INDEX IF EXISTS idx_broadcasts_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_one_active
  ON broadcasts (audience)
  WHERE status = 'sending';
