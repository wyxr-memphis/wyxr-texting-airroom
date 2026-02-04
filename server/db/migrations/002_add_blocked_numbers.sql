-- Migration: Add blocked_numbers table
-- Purpose: Track phone numbers blocked from appearing in DJ dashboard

CREATE TABLE IF NOT EXISTS blocked_numbers (
  phone VARCHAR(20) PRIMARY KEY,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_by VARCHAR(100),
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocked_numbers_phone ON blocked_numbers(phone);
