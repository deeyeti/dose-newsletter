# The Dose AI Assistant — Implementation Plan

> **Vision**: Every week the editorial team asks: *"What should we write about?"*  
> The Dose AI Assistant answers in seconds by querying the entire historical archive of published interviews, cross-referencing verbatim transcripts with real audience engagement metrics (Instagram Reels performance) to surface the stories, themes, and quotes that genuinely resonated.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Data Ingestion
        A[Instagram Graph API] -->|Reels + Metrics: Views, Shares, Saves| S[(Supabase PostgreSQL)]
        B[Groq Whisper / Frame.io] -->|Raw Transcripts & Metadata| S
        C[Embedding Model: text-embedding-3-small] -->|Transcript Vector Embeddings| S
    end

    subgraph Supabase (PostgreSQL + pgvector)
        S -->|Tables: reels, reel_metrics, reel_embeddings| D[Hybrid Search Engine]
    end

    subgraph Dose AI Assistant (Claude Agent)
        E[Editorial User Query] --> F[Claude Tool-Calling Engine]
        F -->|Tool 1: query_archive_by_metric| D
        F -->|Tool 2: semantic_search_quotes| D
        D -->|Grounded Reels + Performance Stats| F
        F -->|Synthesized Answer / Draft| G[Human-in-the-Loop Dashboard]
    end

    G -->|1-Click Action: Send to Route 1 Draft| H[Dose Engine Newsletter Pipeline]
```

---

## 2. Supabase Database Schema

Supabase serves as the single source of truth for all published video assets, time-series performance metrics, and semantic transcript embeddings.

```sql
-- Enable vector search extension
create extension if not exists vector;

-- 1. All published reels and interviews
create table reels (
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
create table reel_metrics (
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
create table reel_embeddings (
  id uuid default gen_random_uuid() primary key,
  reel_id text references reels(id) on delete cascade,
  chunk_text text not null, -- 1-2 sentence verbatim quote or story beat
  speaker_timestamp text,   -- e.g. "00:14 - 00:28"
  embedding vector(1536)    -- OpenAI text-embedding-3-small or Gemini text-embedding-004
);

-- Indexing for high-speed hybrid search
create index idx_reels_published_at on reels(published_at desc);
create index idx_reel_metrics_engagement on reel_metrics(engagement_rate desc);
create index idx_reel_embeddings_vector on reel_embeddings using ivfflat (embedding vector_cosine_ops);
```

---

## 3. Data Ingestion & Sync Pipeline

### A. Instagram Graph API (Metrics Ingestion)
1. **Endpoint**: `GET /{ig-user-id}/media?fields=id,caption,media_type,permalink,timestamp,thumbnail_url`
2. **Insights Metrics**: `GET /{media-id}/insights?metric=plays,shares,saved,comments,likes`
3. **Execution**: A scheduled cron job (or serverless function) polls weekly/daily to update `reel_metrics`.

### B. Speech Transcription & Chunking
1. Transcripts from Groq Whisper (`whisper-large-v3-turbo`) are stored in `reels.transcript`.
2. A chunking worker breaks transcripts into distinct conversational beats (100–200 words each).
3. Embeddings are generated and persisted into `reel_embeddings`.

---

## 4. Claude Tool Calling (Agent Tools)

Claude 3.5 Sonnet acts as an intelligent editorial agent using Anthropic Function Calling (`messages.create` with `tools`):

### Tool 1: `query_archive_by_metric`
- **Use Case**: *"Draft this week's issue from our best performing recent clip"* or *"What were our top 3 most-saved clips in March?"*
- **Parameters**:
  - `metric`: `'saves' | 'shares' | 'engagement_rate' | 'views'`
  - `days`: number (e.g. `30`, `90`, `365`)
  - `limit`: number
- **Action**: Queries Supabase ordered by the specified metric and returns the metadata, metrics, and full transcript.

### Tool 2: `semantic_search_quotes`
- **Use Case**: *"Find every clip where someone talked about money"* or *"Pull the strongest quotes we have ever captured about family."*
- **Parameters**:
  - `query`: string (e.g. `"talking about money and regret"`)
  - `min_saves`: optional number (to filter for high-resonance quotes)
  - `limit`: number
- **Action**: Converts query into an embedding vector, performs cosine similarity against `reel_embeddings`, and returns verbatim quotes with timestamps and performance context.

### Tool 3: `send_to_newsletter_draft`
- **Use Case**: *"Take the #1 clip and draft the newsletter."*
- **Parameters**:
  - `reel_id`: string
  - `custom_angle`: optional string
- **Action**: Feeds the transcript to the existing `writeNewsletter()` generator, inserts the resulting draft into the SQLite `jobs` table, and opens it directly in the Dose Engine human-review drawer.

---

## 5. User Interaction Examples

| Team Prompt | Claude Agent Action | Output |
| :--- | :--- | :--- |
| **"Draft this week's issue from our highest-performing clip this month."** | Calls `query_archive_by_metric(metric: 'shares', days: 30, limit: 1)` | Identifies top clip (e.g. 42k shares, 16k saves). Drafts a publication-grade story with headline, preview dek, verbatim quotes, and creates a pending draft in the dashboard. |
| **"What themes are landing hardest right now?"** | Analyzes `key_themes` vs `engagement_rate` across the last 60 days. | *"Stories focusing on 'unspoken family sacrifices' have a 4.2% save rate (2.1x channel average). 'Career ambition' clips are trailing at 1.1%."* |
| **"Find the strongest quote we have on grief."** | Runs vector search on `reel_embeddings` for `"grief and loss"`. | Returns: *“I realized after my mom passed that I never asked her who she was before us.”* (14.2k saves, Reel ID `#84920`). |

---

## 6. Implementation Roadmap

- [ ] **Phase 1: Supabase & Vector Setup**
  - Create Supabase project and run schema migrations with `pgvector`.
  - Seed initial transcripts from local `.data/dose-engine.db`.
- [ ] **Phase 2: Instagram Graph API Integration**
  - Set up Meta Developer App with Instagram Graph API permissions.
  - Implement scheduled sync route `/api/cron/instagram-sync`.
- [ ] **Phase 3: Embedding Pipeline**
  - Add embedding generator utility using Gemini `text-embedding-004` or OpenAI `text-embedding-3-small`.
  - Store chunked transcript vectors on reel ingest.
- [ ] **Phase 4: Assistant Interface in Dose Engine Dashboard**
  - Add "Dose AI Assistant" slide-out chat bar in `components/dashboard.tsx`.
  - Implement `/api/assistant/chat` with Claude tool calling.
  - Connect "Draft this clip" button to Route 1 review pipeline.
