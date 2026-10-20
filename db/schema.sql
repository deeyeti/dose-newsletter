-- Dose Engine Route 1 local schema. Applied by lib/db.ts on startup.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  frameio_asset_id TEXT NOT NULL UNIQUE,
  frameio_project_id TEXT,
  filename TEXT NOT NULL,
  media_type TEXT,
  duration_seconds REAL,
  status TEXT NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  verified INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  text TEXT NOT NULL,
  language TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  subject TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  closing TEXT,
  recipient_email TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_sends (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES drafts(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  sent_at TEXT,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
