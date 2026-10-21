-- =========================================================================
-- The Dose AI Assistant — Supabase PostgreSQL Schema & pgvector Setup
-- Run this script in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/fsoxehtneqjgrbrsqhqr/sql/new
-- =========================================================================

-- Enable vector search extension
create extension if not exists vector;

-- 1. All published reels and interviews
create table if not exists reels (
  id text primary key, -- Instagram Media ID or Frame.io Asset ID
  permalink text,
  thumbnail_url text,
  caption text,
  published_at timestamp with time zone,
  transcript text not null,
  summary text,
  key_themes text[], -- e.g. ['family', 'money', 'grief', 'kindness', 'regret']
  created_at timestamp with time zone default now()
);

-- 2. Performance metrics snapshot (updated via Instagram Graph API)
create table if not exists reel_metrics (
  id uuid default gen_random_uuid() primary key,
  reel_id text references reels(id) on delete cascade,
  views int default 0,
  likes int default 0,
  comments int default 0,
  shares int default 0,
  saves int default 0, -- Critical signal for emotional resonance
  engagement_rate numeric generated always as (
    case when views > 0 then ((shares * 2 + saves * 2 + comments + likes)::numeric / views) * 100 else 0 end
  ) stored,
  recorded_at timestamp with time zone default now()
);

-- 3. Transcript embeddings for semantic quote & theme searching
create table if not exists reel_embeddings (
  id uuid default gen_random_uuid() primary key,
  reel_id text references reels(id) on delete cascade,
  chunk_text text not null, -- 1-2 sentence verbatim quote or story beat
  speaker_timestamp text,   -- e.g. "00:14 - 00:28"
  embedding vector(1536)    -- Optional dense vector embedding (1536 dimensions)
);

-- Indexes for high-speed queries
create index if not exists idx_reels_published_at on reels(published_at desc);
create index if not exists idx_reel_metrics_engagement on reel_metrics(engagement_rate desc);
create index if not exists idx_reel_metrics_saves on reel_metrics(saves desc);
create index if not exists idx_reel_metrics_shares on reel_metrics(shares desc);

-- Vector search matching function (cosine similarity)
create or replace function match_reel_chunks (
  query_embedding vector(1536),
  match_threshold float default 0.2,
  match_count int default 5
)
returns table (
  id uuid,
  reel_id text,
  chunk_text text,
  speaker_timestamp text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    re_emb.id,
    re_emb.reel_id,
    re_emb.chunk_text,
    re_emb.speaker_timestamp,
    (1 - (re_emb.embedding <=> query_embedding))::float as similarity
  from reel_embeddings re_emb
  where 1 - (re_emb.embedding <=> query_embedding) > match_threshold
  order by re_emb.embedding <=> query_embedding
  limit match_count;
end;
$$;
