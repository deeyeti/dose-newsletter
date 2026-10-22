-- =========================================================================
-- Dose Engine — Route 1 Video-to-Newsletter Pipeline Schema for Supabase
-- Paste and run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql/new
-- =========================================================================

-- 1. Source Video Jobs
CREATE TABLE IF NOT EXISTS public.jobs (
  id TEXT PRIMARY KEY,
  frameio_asset_id TEXT NOT NULL UNIQUE,
  frameio_project_id TEXT,
  filename TEXT NOT NULL,
  media_type TEXT,
  duration_seconds NUMERIC,
  status TEXT NOT NULL DEFAULT 'received',
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Webhook Ingestion Events (for deduplication and audit trail)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT NOT NULL DEFAULT 'accepted'
);

-- 3. Transcripts (Cached forever — never re-transcribe the same video)
CREATE TABLE IF NOT EXISTS public.transcripts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  frameio_asset_id TEXT,
  filename TEXT,
  text TEXT NOT NULL,
  language TEXT,
  provider TEXT NOT NULL DEFAULT 'groq',
  model TEXT NOT NULL DEFAULT 'whisper-large-v3-turbo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.transcripts ADD COLUMN IF NOT EXISTS frameio_asset_id TEXT;
ALTER TABLE public.transcripts ADD COLUMN IF NOT EXISTS filename TEXT;


-- 4. Newsletter Drafts (persisted across all devices and Lambda instances)
CREATE TABLE IF NOT EXISTS public.drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  closing TEXT,
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Email Sends & Delivery Logs (audit trail & idempotency lock)
CREATE TABLE IF NOT EXISTS public.email_sends (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES public.drafts(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES public.jobs(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'sending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.email_sends ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES public.jobs(id) ON DELETE CASCADE;


-- 6. Job Lifecycle Event Logs
CREATE TABLE IF NOT EXISTS public.job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Beehiiv Posts & Analytics (for Human Co-Editor and AI Assistant queries)
CREATE TABLE IF NOT EXISTS public.beehiiv_posts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  draft_id TEXT REFERENCES public.drafts(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  subtitle TEXT,
  web_url TEXT,
  preview_url TEXT,
  scheduled_at TIMESTAMPTZ,
  stats JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON public.jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_frameio_asset_id ON public.jobs(frameio_asset_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_job_id ON public.transcripts(job_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_asset_id ON public.transcripts(frameio_asset_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_filename ON public.transcripts(filename);

CREATE INDEX IF NOT EXISTS idx_drafts_job_id ON public.drafts(job_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_draft_id ON public.email_sends(draft_id);
CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON public.job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_beehiiv_posts_job_id ON public.beehiiv_posts(job_id);
CREATE INDEX IF NOT EXISTS idx_beehiiv_posts_status ON public.beehiiv_posts(status);

-- Enable Row Level Security (RLS)
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beehiiv_posts ENABLE ROW LEVEL SECURITY;

-- Allow full access to service_role and anon (or authenticated) users
CREATE POLICY "Allow all operations for anon and service_role" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon and service_role" ON public.webhook_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon and service_role" ON public.transcripts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon and service_role" ON public.drafts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon and service_role" ON public.email_sends FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon and service_role" ON public.job_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon and service_role" ON public.beehiiv_posts FOR ALL USING (true) WITH CHECK (true);

