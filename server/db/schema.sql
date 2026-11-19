-- WYXR Text App Database Schema

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read BOOLEAN NOT NULL DEFAULT FALSE,
  replied BOOLEAN NOT NULL DEFAULT FALSE,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Settings table for app configuration
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session table for express-session with connect-pg-simple
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

-- Blocked numbers table for preventing messages from appearing in DJ dashboard
CREATE TABLE IF NOT EXISTS blocked_numbers (
  phone VARCHAR(20) PRIMARY KEY,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_by VARCHAR(100),
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  source VARCHAR(100),
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
CREATE INDEX IF NOT EXISTS idx_blocked_numbers_phone ON blocked_numbers(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_opted_in ON contacts(opted_in);
CREATE INDEX IF NOT EXISTS idx_opt_in_log_phone ON opt_in_log(phone_number);
CREATE INDEX IF NOT EXISTS idx_opt_in_log_timestamp ON opt_in_log(timestamp);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Broadcasts - one row per bulk send to the opted-in list (migration 006)
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, sending, completed, canceled
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  canceled_by VARCHAR(100),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  character_count INTEGER,
  segment_count INTEGER,
  encoding VARCHAR(10),
  last_test_sent_at TIMESTAMPTZ,
  last_test_phone VARCHAR(20),
  audience VARCHAR(20) NOT NULL DEFAULT 'listeners' CHECK (audience IN ('listeners', 'djs')), -- migration 007
  from_number VARCHAR(20),                     -- number the broadcast is sent from (migration 007)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing databases: add the DJ texting columns (migration 007)
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

-- One row per (broadcast, phone) - makes sends resumable and prevents
-- double-texting if the worker restarts mid-broadcast
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  opt_in_method VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  twilio_sid VARCHAR(64),
  error_code VARCHAR(20),
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_id ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_worker_queue
  ON broadcast_recipients(broadcast_id, status, next_attempt_at);

-- At most one broadcast per audience may be actively sending at a time
-- (migration 007). Drops the older single-slot ((1)) version if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_broadcasts_one_active'
      AND indexdef NOT LIKE '%(audience)%'
  ) THEN
    DROP INDEX idx_broadcasts_one_active;
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_one_active
  ON broadcasts (audience)
  WHERE status = 'sending';

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

-- DJ texting (migration 007) - kept fully apart from listener contacts
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

-- Insert default settings
INSERT INTO settings (key, value) VALUES ('messaging_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
