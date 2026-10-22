import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import type { DraftInput, Job, JobStatus, NewsletterDraft, BeehiivPostRecord } from "@/lib/types";
import {
  isSupabaseConfigured,
  supabaseUpsertJob,
  supabaseUpsertTranscript,
  supabaseUpsertDraft,
  supabaseUpsertEmailSend,
  supabaseUpsertBeehiivPost,
  supabaseInsertEvent,
  supabaseDeleteJob,
  supabaseRecordWebhook,
} from "@/lib/supabase";


let DatabaseSyncClass: any = null;
try {
  DatabaseSyncClass = require("node:sqlite").DatabaseSync;
} catch {

  // node:sqlite is not available in some serverless runtimes
}

const isVercel = Boolean(process.env.VERCEL);
const isTest = process.env.NODE_ENV === "test" || process.env.npm_lifecycle_event === "test" || process.argv.some((a) => a.includes("test"));
const shouldSyncSupabase = () => isSupabaseConfigured() && !isTest;
const dbPath = isTest
  ? ":memory:"
  : (isVercel
      ? "/tmp/dose-engine.db"
      : (env("DATABASE_PATH")
          ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), env("DATABASE_PATH"))
          : path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data/dose-engine.db")));

if (!isVercel && dbPath !== ":memory:") {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch {}
}

const SCHEMA_SQL = `
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
CREATE TABLE IF NOT EXISTS beehiiv_posts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  draft_id TEXT REFERENCES drafts(id),
  publication_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  web_url TEXT,
  preview_url TEXT,
  scheduled_at TEXT,
  stats_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function createDbConnection(): any {
  if (!DatabaseSyncClass) return null;
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const db = new DatabaseSyncClass(dbPath);
      db.exec("PRAGMA busy_timeout = 20000;");
      if (dbPath !== ":memory:") {
        try {
          db.exec("PRAGMA journal_mode = WAL;");
        } catch (walErr: unknown) {
          const msg = walErr instanceof Error ? walErr.message : String(walErr);
          if (!msg.includes("locked") && !msg.includes("busy")) throw walErr;
        }
      }
      db.exec(SCHEMA_SQL);
      return db;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLocked = msg.includes("locked") || msg.includes("busy") || (typeof err === "object" && err !== null && (err as { errcode?: number }).errcode === 5);
      if (isLocked && attempt < maxRetries) {
        const waitMs = 50 + Math.floor(Math.random() * 80) * attempt;
        const until = Date.now() + waitMs;
        while (Date.now() < until) {}
        continue;
      }
      console.warn("[db] SQLite connection initialization failed:", msg);
      return null;
    }
  }
  return null;
}

let sqlInstance: any = null;
let sqlInitialized = false;

function getDb(): any {
  if (!sqlInitialized) {
    sqlInitialized = true;
    sqlInstance = createDbConnection();
  }
  return sqlInstance;
}

const now = () => new Date().toISOString();

type Row = Record<string, unknown>;
const toJob = (r: Row): Job => ({
  id: String(r.id),
  frameioAssetId: String(r.frameio_asset_id),
  frameioProjectId: r.frameio_project_id ? String(r.frameio_project_id) : undefined,
  filename: String(r.filename),
  mediaType: r.media_type ? String(r.media_type) : undefined,
  durationSeconds: r.duration_seconds == null ? undefined : Number(r.duration_seconds),
  status: r.status as JobStatus,
  isSample: Boolean(r.is_sample),
  errorCode: r.error_code ? String(r.error_code) : undefined,
  errorMessage: r.error_message ? String(r.error_message) : undefined,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  draftSubject: r.draft_subject ? String(r.draft_subject) : undefined,
  recipientEmail: r.draft_recipient ? String(r.draft_recipient) : undefined,
});
const toDraft = (r: Row): NewsletterDraft => ({ id: String(r.id), jobId: String(r.job_id), subject: String(r.subject), previewText: String(r.preview_text), headline: String(r.headline), body: String(r.body), closing: r.closing ? String(r.closing) : undefined, recipientEmail: r.recipient_email ? String(r.recipient_email) : undefined, status: r.status as NewsletterDraft["status"], updatedAt: String(r.updated_at) });
const toBeehiivPost = (r: Row): BeehiivPostRecord => {
  let stats = null;
  if (r.stats_json && typeof r.stats_json === "string") {
    try {
      stats = JSON.parse(r.stats_json);
    } catch {}
  }
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    draftId: r.draft_id ? String(r.draft_id) : undefined,
    publicationId: String(r.publication_id),
    status: r.status as BeehiivPostRecord["status"],
    title: r.title ? String(r.title) : undefined,
    subtitle: r.subtitle ? String(r.subtitle) : undefined,
    webUrl: r.web_url ? String(r.web_url) : undefined,
    previewUrl: r.preview_url ? String(r.preview_url) : undefined,
    scheduledAt: r.scheduled_at ? String(r.scheduled_at) : null,
    stats,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
};

// In-memory fallbacks for serverless environments where SQLite is unavailable
const memJobs = new Map<string, Job>();
const memDrafts = new Map<string, NewsletterDraft>();
const memEvents = new Map<string, Array<{ status: string; message: string; created_at: string }>>();
const memTranscripts = new Map<string, { text: string; language?: string; model: string; createdAt: string }>();
const memWebhooks = new Set<string>();
const memEmailSends = new Map<string, { idempotencyKey: string; status: string; providerMessageId?: string; sentAt?: string; errorMessage?: string }>();
const memBeehiivPosts = new Map<string, BeehiivPostRecord>();

// In-memory fallbacks for serverless environments where SQLite is unavailable
const memJobs = new Map<string, Job>();
const memDrafts = new Map<string, NewsletterDraft>();
const memEvents = new Map<string, Array<{ status: string; message: string; created_at: string }>>();
const memTranscripts = new Map<string, { text: string; language?: string; model: string; createdAt: string }>();
const memWebhooks = new Set<string>();
const memEmailSends = new Map<string, { idempotencyKey: string; status: string; providerMessageId?: string; sentAt?: string; errorMessage?: string }>();

export const store = {
  listJobs(): Job[] {
    const db = getDb();
    if (db) {
      try {
        const rows = db.prepare(`
          SELECT 
            j.*,
            d.subject AS draft_subject,
            d.recipient_email AS draft_recipient
          FROM jobs j
          LEFT JOIN drafts d ON d.job_id = j.id
          ORDER BY j.created_at DESC
          LIMIT 50
        `).all() as Row[];
        return rows.map(toJob);
      } catch (err) {
        console.error("[db] listJobs query failed:", err);
      }
    }
    return Array.from(memJobs.values())
      .map((job) => {
        const draft = memDrafts.get(job.id);
        return {
          ...job,
          draftSubject: draft?.subject,
          recipientEmail: draft?.recipientEmail,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  seedJob(job: Job) {
    memJobs.set(job.id, job);
    const db = getDb();
    if (db) {
      try {
        db.prepare(
          "INSERT INTO jobs (id,frameio_asset_id,frameio_project_id,filename,media_type,status,is_sample,error_code,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, duration_seconds=COALESCE(excluded.duration_seconds, jobs.duration_seconds), error_code=excluded.error_code, error_message=excluded.error_message, updated_at=excluded.updated_at"
        ).run(
          job.id,
          job.frameioAssetId,
          job.frameioProjectId ?? null,
          job.filename,
          job.mediaType ?? null,
          job.status,
          job.isSample ? 1 : 0,
          job.errorCode ?? null,
          job.errorMessage ?? null,
          job.createdAt,
          job.updatedAt
        );
      } catch {}
    }
  },

  seedDetail(detail: { job: Job; transcript: any; draft: NewsletterDraft | null; events: any[]; email: any; beehiivPost?: BeehiivPostRecord | null }) {
    this.seedJob(detail.job);
    if (detail.draft) {
      memDrafts.set(detail.job.id, detail.draft);
      const db = getDb();
      if (db) {
        try {
          db.prepare(
            "INSERT INTO drafts (id,job_id,subject,preview_text,headline,body,closing,recipient_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'draft',?,?) ON CONFLICT(job_id) DO UPDATE SET subject=excluded.subject, preview_text=excluded.preview_text, headline=excluded.headline, body=excluded.body, closing=excluded.closing, recipient_email=excluded.recipient_email, status=excluded.status, updated_at=excluded.updated_at"
          ).run(
            detail.draft.id,
            detail.draft.jobId,
            detail.draft.subject,
            detail.draft.previewText,
            detail.draft.headline,
            detail.draft.body,
            detail.draft.closing ?? null,
            detail.draft.recipientEmail ?? null,
            detail.draft.updatedAt,
            detail.draft.updatedAt
          );
        } catch {}
      }
    }
    if (detail.transcript) {
      memTranscripts.set(detail.job.id, detail.transcript);
      const db = getDb();
      if (db) {
        try {
          db.prepare(
            "INSERT INTO transcripts (id,job_id,text,language,provider,model,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET text=excluded.text, language=excluded.language, provider=excluded.provider, model=excluded.model"
          ).run(
            randomUUID(),
            detail.job.id,
            detail.transcript.text,
            detail.transcript.language ?? null,
            "groq",
            detail.transcript.model,
            detail.transcript.createdAt
          );
        } catch {}
      }
    }
    if (detail.events && detail.events.length > 0) {
      memEvents.set(detail.job.id, detail.events);
      const db = getDb();
      if (db) {
        try {
          const insertStmt = db.prepare(
            "INSERT OR IGNORE INTO job_events (id,job_id,status,message,created_at) VALUES (?,?,?,?,?)"
          );
          for (const ev of detail.events) {
            insertStmt.run(ev.id || randomUUID(), detail.job.id, ev.status, ev.message, ev.created_at || now());
          }
        } catch {}
      }
    }
    if (detail.email && detail.draft) {
      memEmailSends.set(detail.draft.id, {
        idempotencyKey: detail.email.idempotency_key || randomUUID(),
        status: detail.email.status,
        providerMessageId: detail.email.provider_message_id,
        sentAt: detail.email.sent_at,
        errorMessage: detail.email.error_message,
      });
      const db = getDb();
      if (db) {
        try {
          db.prepare(
            "INSERT INTO email_sends (id,draft_id,idempotency_key,provider_message_id,status,sent_at,error_message) VALUES (?,?,?,?,?,?,?) ON CONFLICT(draft_id) DO UPDATE SET status=excluded.status, provider_message_id=excluded.provider_message_id, sent_at=excluded.sent_at, error_message=excluded.error_message"
          ).run(
            randomUUID(),
            detail.draft.id,
            detail.email.idempotency_key || randomUUID(),
            detail.email.provider_message_id ?? null,
            detail.email.status,
            detail.email.sent_at ?? null,
            detail.email.error_message ?? null
          );
        } catch {}
      }
    }
    if (detail.beehiivPost) {
      this.saveBeehiivPost(detail.beehiivPost);
    }
  },

  async deleteJob(id: string) {
    const db = getDb();
    if (db) {
      try {
        const draft = this.getDraft(id);
        if (draft) {
          db.prepare("DELETE FROM email_sends WHERE draft_id=?").run(draft.id);
          db.prepare("DELETE FROM drafts WHERE id=?").run(draft.id);
        }
        db.prepare("DELETE FROM beehiiv_posts WHERE job_id=?").run(id);
        db.prepare("DELETE FROM job_events WHERE job_id=?").run(id);
        db.prepare("DELETE FROM transcripts WHERE job_id=?").run(id);
        db.prepare("DELETE FROM jobs WHERE id=?").run(id);
      } catch {}
    }
    const memDraft = memDrafts.get(id);
    if (memDraft) {
      memEmailSends.delete(memDraft.id);
      memDrafts.delete(id);
    }
    memBeehiivPosts.delete(id);
    memEvents.delete(id);
    memTranscripts.delete(id);
    memJobs.delete(id);

    if (isSupabaseConfigured()) {
      await supabaseDeleteJob(id).catch(() => {});
    }
  },

  getJob(id: string) {
    const db = getDb();
    if (db) {
      try {
        const row = db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
        if (row) return toJob(row);
      } catch {}
    }
    return memJobs.get(id);
  },

  getByAsset(assetId: string) {
    const db = getDb();
    if (db) {
      try {
        const row = db.prepare("SELECT * FROM jobs WHERE frameio_asset_id=?").get(assetId) as Row | undefined;
        if (row) return toJob(row);
      } catch {}
    }
    return Array.from(memJobs.values()).find((j) => j.frameioAssetId === assetId);
  },

  createJob(input: { assetId: string; projectId?: string; filename: string; mediaType?: string; sample?: boolean }) {
    const existing = this.getByAsset(input.assetId);
    if (existing) return { job: existing, created: false };
    const id = randomUUID(), time = now();

    const db = getDb();
    if (db) {
      try {
        db.prepare("INSERT INTO jobs (id,frameio_asset_id,frameio_project_id,filename,media_type,status,is_sample,created_at,updated_at) VALUES (?,?,?,?,?,'received',?,?,?)").run(id, input.assetId, input.projectId ?? null, input.filename, input.mediaType ?? null, input.sample ? 1 : 0, time, time);
      } catch (err) {
        console.warn("[db] SQLite insert failed, falling back to memory:", err);
      }
    }

    const job: Job = {
      id,
      frameioAssetId: input.assetId,
      frameioProjectId: input.projectId,
      filename: input.filename,
      mediaType: input.mediaType,
      status: "received",
      isSample: Boolean(input.sample),
      createdAt: time,
      updatedAt: time,
    };
    memJobs.set(id, job);

    if (shouldSyncSupabase()) {
      void supabaseUpsertJob(job);
    }

    this.event(id, "received", input.sample ? "Created labelled sample job." : "Webhook or manual check received asset.");
    return { job, created: true };
  },

  event(jobId: string, status: string, message: string) {
    const time = now();
    const eventId = randomUUID();
    const db = getDb();
    if (db) {
      try {
        db.prepare("INSERT INTO job_events (id,job_id,status,message,created_at) VALUES (?,?,?,?,?)").run(eventId, jobId, status, message, time);
      } catch {}
    }
    const list = memEvents.get(jobId) || [];
    list.push({ status, message, created_at: time });
    memEvents.set(jobId, list);

    if (shouldSyncSupabase()) {
      void supabaseInsertEvent({ id: eventId, jobId, status, message, createdAt: time });
    }
  },

  setJob(jobId: string, status: JobStatus, fields: { durationSeconds?: number; errorCode?: string | null; errorMessage?: string | null } = {}) {
    const time = now();
    const db = getDb();
    if (db) {
      try {
        db.prepare("UPDATE jobs SET status=?, duration_seconds=COALESCE(?,duration_seconds), error_code=?, error_message=?, updated_at=? WHERE id=?").run(status, fields.durationSeconds ?? null, fields.errorCode ?? null, fields.errorMessage ?? null, time, jobId);
      } catch {}
    }
    const job = memJobs.get(jobId);
    if (job) {
      job.status = status;
      if (fields.durationSeconds !== undefined) job.durationSeconds = fields.durationSeconds;
      if (fields.errorCode !== undefined) job.errorCode = fields.errorCode || undefined;
      if (fields.errorMessage !== undefined) job.errorMessage = fields.errorMessage || undefined;
      job.updatedAt = time;

      if (shouldSyncSupabase()) {
        void supabaseUpsertJob(job);
      }
    }
    this.event(jobId, status, fields.errorMessage || status.replaceAll("_", " "));
  },

  setMetadata(jobId: string, metadata: { filename: string; mediaType?: string; projectId?: string }) {
    const time = now();
    const db = getDb();
    if (db) {
      try {
        db.prepare("UPDATE jobs SET filename=?,media_type=?,frameio_project_id=COALESCE(?,frameio_project_id),updated_at=? WHERE id=?").run(metadata.filename, metadata.mediaType ?? null, metadata.projectId ?? null, time, jobId);
      } catch {}
    }
    const job = memJobs.get(jobId);
    if (job) {
      job.filename = metadata.filename;
      if (metadata.mediaType) job.mediaType = metadata.mediaType;
      if (metadata.projectId) job.frameioProjectId = metadata.projectId;
      job.updatedAt = time;

      if (shouldSyncSupabase()) {
        void supabaseUpsertJob(job);
      }
    }
  },


  fail(jobId: string, code: string, message: string) {
    this.setJob(jobId, "failed", { errorCode: code, errorMessage: message });
  },

  setTranscript(jobId: string, text: string, model: string, language?: string) {
    const time = now();
    const db = getDb();
    if (db) {
      try {
        db.prepare("INSERT INTO transcripts (id,job_id,text,language,provider,model,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET text=excluded.text,model=excluded.model,language=excluded.language").run(randomUUID(), jobId, text, language ?? null, "groq", model, time);
      } catch {}
    }
    memTranscripts.set(jobId, { text, language, model, createdAt: time });

    if (shouldSyncSupabase()) {
      const job = this.getJob(jobId);
      void supabaseUpsertTranscript({
        id: randomUUID(),
        jobId,
        text,
        language,
        model,
        assetId: job?.frameioAssetId,
        filename: job?.filename,
        createdAt: time,
      });
    }
  },

  saveDraft(jobId: string, draft: DraftInput) {
    const time = now();
    const existingDb = this.getDraft(jobId);
    const existingMem = memDrafts.get(jobId);
    const id = existingDb?.id || existingMem?.id || randomUUID();
    const status = existingDb?.status || existingMem?.status || "draft";

    const db = getDb();
    if (db) {
      try {
        if (existingDb) {
          db.prepare("UPDATE drafts SET subject=?,preview_text=?,headline=?,body=?,closing=?,recipient_email=?,updated_at=? WHERE job_id=?").run(draft.subject, draft.previewText, draft.headline, draft.body, draft.closing ?? null, draft.recipientEmail ?? null, time, jobId);
        } else {
          db.prepare("INSERT INTO drafts (id,job_id,subject,preview_text,headline,body,closing,recipient_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'draft',?,?)").run(id, jobId, draft.subject, draft.previewText, draft.headline, draft.body, draft.closing ?? null, draft.recipientEmail ?? null, time, time);
        }
      } catch {}
    }
    const draftObj: NewsletterDraft = {
      id,
      jobId,
      subject: draft.subject,
      previewText: draft.previewText,
      headline: draft.headline,
      body: draft.body,
      closing: draft.closing,
      recipientEmail: draft.recipientEmail,
      status,
      updatedAt: time,
    };
    memDrafts.set(jobId, draftObj);

    if (shouldSyncSupabase()) {
      void supabaseUpsertDraft(draftObj);
    }

    return draftObj;
  },

  getDraft(jobId: string) {
    const db = getDb();
    if (db) {
      try {
        const row = db.prepare("SELECT * FROM drafts WHERE job_id=?").get(jobId) as Row | undefined;
        if (row) return toDraft(row);
      } catch {}
    }
    return memDrafts.get(jobId);
  },

  getBeehiivPost(jobId: string): BeehiivPostRecord | null {
    const db = getDb();
    if (db) {
      try {
        const row = db.prepare("SELECT * FROM beehiiv_posts WHERE job_id=? ORDER BY created_at DESC LIMIT 1").get(jobId) as Row | undefined;
        if (row) return toBeehiivPost(row);
      } catch {}
    }
    return memBeehiivPosts.get(jobId) || null;
  },

  saveBeehiivPost(post: BeehiivPostRecord): BeehiivPostRecord {
    const db = getDb();
    const statsJson = post.stats ? JSON.stringify(post.stats) : null;
    if (db) {
      try {
        db.prepare(
          `INSERT INTO beehiiv_posts (id,job_id,draft_id,publication_id,status,title,subtitle,web_url,preview_url,scheduled_at,stats_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             status=excluded.status,
             title=COALESCE(excluded.title, beehiiv_posts.title),
             subtitle=COALESCE(excluded.subtitle, beehiiv_posts.subtitle),
             web_url=COALESCE(excluded.web_url, beehiiv_posts.web_url),
             preview_url=COALESCE(excluded.preview_url, beehiiv_posts.preview_url),
             scheduled_at=excluded.scheduled_at,
             stats_json=COALESCE(excluded.stats_json, beehiiv_posts.stats_json),
             updated_at=excluded.updated_at`
        ).run(
          post.id,
          post.jobId,
          post.draftId ?? null,
          post.publicationId,
          post.status,
          post.title ?? null,
          post.subtitle ?? null,
          post.webUrl ?? null,
          post.previewUrl ?? null,
          post.scheduledAt ?? null,
          statsJson,
          post.createdAt,
          post.updatedAt
        );
      } catch (err) {
        console.warn("[db] saveBeehiivPost sqlite error:", err);
      }
    }
    memBeehiivPosts.set(post.jobId, post);

    if (shouldSyncSupabase()) {
      void supabaseUpsertBeehiivPost(post);
    }
    return post;
  },

  jobDetail(id: string) {
    const job = this.getJob(id);
    if (!job) return null;
    const beehiivPost = this.getBeehiivPost(id);
    const db = getDb();
    if (db) {
      try {
        const transcript = db.prepare("SELECT text,language,model,created_at FROM transcripts WHERE job_id=?").get(id) as Row | undefined;
        let events = db.prepare("SELECT status,message,created_at FROM job_events WHERE job_id=? ORDER BY created_at ASC").all(id) as Row[];
        const draft = this.getDraft(id) || memDrafts.get(id);
        const email = draft ? db.prepare("SELECT status,provider_message_id,sent_at,error_message FROM email_sends WHERE draft_id=?").get(draft.id) as Row | undefined : undefined;

        if (!events || events.length === 0) {
          events = (memEvents.get(id) || []) as any;
        }

        return {
          job,
          transcript: transcript
            ? { text: String(transcript.text), language: transcript.language as string | undefined, model: String(transcript.model), createdAt: String(transcript.created_at) }
            : (memTranscripts.get(id) || null),
          draft: draft || null,
          events,
          email: email ?? (draft ? (memEmailSends.get(draft.id) as any) ?? null : null),
          beehiivPost,
        };
      } catch {}
    }

    return {
      job,
      transcript: memTranscripts.get(id) || null,
      draft: memDrafts.get(id) || null,
      events: memEvents.get(id) || [],
      email: null,
      beehiivPost,
    };
  },

  recordWebhook(eventId: string, assetId: string, type: string, verified: boolean) {
    const time = now();
    const db = getDb();
    if (db) {
      try {
        db.prepare("INSERT INTO webhook_events (provider_event_id,asset_id,event_type,verified,received_at,processing_status) VALUES (?,?,?,?,?,?)").run(eventId, assetId, type, verified ? 1 : 0, time, "accepted");
        if (shouldSyncSupabase()) {
          void supabaseRecordWebhook(eventId, assetId, type, verified);
        }
        return true;
      } catch {
        return false;
      }
    }
    if (memWebhooks.has(eventId)) return false;
    memWebhooks.add(eventId);
    if (shouldSyncSupabase()) {
      void supabaseRecordWebhook(eventId, assetId, type, verified);
    }
    return true;
  },

  beginSend(draftId: string, allowResend = false) {
    const key = randomUUID();
    const db = getDb();
    if (db) {
      try {
        const existing = db.prepare("SELECT * FROM email_sends WHERE draft_id=?").get(draftId) as Row | undefined;
        if (!allowResend && existing?.status === "sent") return { allowed: false, reason: "already_sent" };
        if (existing?.status === "sending") return { allowed: false, reason: "sending" };
        if (existing) {
          db.prepare("UPDATE email_sends SET idempotency_key=?,status='sending',error_message=NULL WHERE draft_id=?").run(key, draftId);
        } else {
          db.prepare("INSERT INTO email_sends (id,draft_id,idempotency_key,status) VALUES (?,?,?,'sending')").run(randomUUID(), draftId, key);
        }
        db.prepare("UPDATE drafts SET status='sending',updated_at=? WHERE id=?").run(now(), draftId);
        memEmailSends.set(draftId, { idempotencyKey: key, status: "sending" });

        const draftObj = Array.from(memDrafts.values()).find((d) => d.id === draftId);
        if (draftObj) draftObj.status = "sending";
        if (shouldSyncSupabase()) {
          void supabaseUpsertEmailSend({
            id: randomUUID(),
            draftId,
            jobId: draftObj?.jobId,
            idempotencyKey: key,
            status: "sending",
          });
        }
        return { allowed: true, key };
      } catch {}
    }
    const existingMem = memEmailSends.get(draftId);
    if (!allowResend && existingMem?.status === "sent") return { allowed: false, reason: "already_sent" };
    if (existingMem?.status === "sending") return { allowed: false, reason: "sending" };
    memEmailSends.set(draftId, { idempotencyKey: key, status: "sending" });

    const draftObj = Array.from(memDrafts.values()).find((d) => d.id === draftId);
    if (draftObj) draftObj.status = "sending";
    if (shouldSyncSupabase()) {
      void supabaseUpsertEmailSend({
        id: randomUUID(),
        draftId,
        jobId: draftObj?.jobId,
        idempotencyKey: key,
        status: "sending",
      });
    }
    return { allowed: true, key };
  },

  completeSend(draftId: string, providerId: string) {
    const time = now();
    const db = getDb();
    if (db) {
      try {
        db.prepare("UPDATE email_sends SET status='sent',provider_message_id=?,sent_at=?,error_message=NULL WHERE draft_id=?").run(providerId, time, draftId);
        db.prepare("UPDATE drafts SET status='sent',updated_at=? WHERE id=?").run(time, draftId);
      } catch {}
    }
    const mem = memEmailSends.get(draftId);
    if (mem) {
      mem.status = "sent";
      mem.providerMessageId = providerId;
      mem.sentAt = time;
    }

    const draftObj = Array.from(memDrafts.values()).find((d) => d.id === draftId);
    if (draftObj) {
      draftObj.status = "sent";
      draftObj.updatedAt = time;
    }
    if (shouldSyncSupabase()) {
      void supabaseUpsertEmailSend({
        id: randomUUID(),
        draftId,
        jobId: draftObj?.jobId,
        idempotencyKey: "sent",
        status: "sent",
        providerMessageId: providerId,
        sentAt: time,
      });
    }
  },

  failSend(draftId: string, message: string) {
    const time = now();
    const db = getDb();
    if (db) {
      try {
        db.prepare("UPDATE email_sends SET status='failed',error_message=? WHERE draft_id=?").run(message, draftId);
        db.prepare("UPDATE drafts SET status='draft',updated_at=? WHERE id=?").run(time, draftId);
      } catch {}
    }
    const mem = memEmailSends.get(draftId);
    if (mem) {
      mem.status = "failed";
      mem.errorMessage = message;
    }

    const draftObj = Array.from(memDrafts.values()).find((d) => d.id === draftId);
    if (shouldSyncSupabase()) {
      void supabaseUpsertEmailSend({
        id: randomUUID(),
        draftId,
        jobId: draftObj?.jobId,
        idempotencyKey: "failed",
        status: "failed",
        errorMessage: message,
      });
    }
  },


};
