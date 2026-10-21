import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import type { DraftInput, Job, JobStatus, NewsletterDraft } from "@/lib/types";

const dbPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), env("DATABASE_PATH") || ".data/dose-engine.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
function createDbConnection(): DatabaseSync {
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const db = new DatabaseSync(dbPath);
      // Set busy_timeout first so SQLite waits on locks
      db.exec("PRAGMA busy_timeout = 20000;");
      try {
        db.exec("PRAGMA journal_mode = WAL;");
      } catch (walErr: unknown) {
        const msg = walErr instanceof Error ? walErr.message : String(walErr);
        if (!msg.includes("locked") && !msg.includes("busy")) throw walErr;
      }
      db.exec(fs.readFileSync(path.join(process.cwd(), "db/schema.sql"), "utf8"));
      return db;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLocked = msg.includes("locked") || msg.includes("busy") || (typeof err === "object" && err !== null && (err as { errcode?: number }).errcode === 5);
      if (isLocked && attempt < maxRetries) {
        const waitMs = 50 + Math.floor(Math.random() * 80) * attempt;
        const until = Date.now() + waitMs;
        while (Date.now() < until) {} // synchronous backoff for build worker
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to initialize database after retries.");
}

const sql = createDbConnection();

const now = () => new Date().toISOString();

type Row = Record<string, unknown>;
const toJob = (r: Row): Job => ({ id: String(r.id), frameioAssetId: String(r.frameio_asset_id), frameioProjectId: r.frameio_project_id ? String(r.frameio_project_id) : undefined, filename: String(r.filename), mediaType: r.media_type ? String(r.media_type) : undefined, durationSeconds: r.duration_seconds == null ? undefined : Number(r.duration_seconds), status: r.status as JobStatus, isSample: Boolean(r.is_sample), errorCode: r.error_code ? String(r.error_code) : undefined, errorMessage: r.error_message ? String(r.error_message) : undefined, createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
const toDraft = (r: Row): NewsletterDraft => ({ id: String(r.id), jobId: String(r.job_id), subject: String(r.subject), previewText: String(r.preview_text), headline: String(r.headline), body: String(r.body), closing: r.closing ? String(r.closing) : undefined, recipientEmail: r.recipient_email ? String(r.recipient_email) : undefined, status: r.status as NewsletterDraft["status"], updatedAt: String(r.updated_at) });

export const store = {
  listJobs() { return (sql.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50").all() as Row[]).map(toJob); },
  getJob(id: string) { const row = sql.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined; return row && toJob(row); },
  getByAsset(assetId: string) { const row = sql.prepare("SELECT * FROM jobs WHERE frameio_asset_id=?").get(assetId) as Row | undefined; return row && toJob(row); },
  createJob(input: { assetId: string; projectId?: string; filename: string; mediaType?: string; sample?: boolean }) {
    const existing = this.getByAsset(input.assetId); if (existing) return { job: existing, created: false };
    const id = randomUUID(), time = now();
    sql.prepare("INSERT INTO jobs (id,frameio_asset_id,frameio_project_id,filename,media_type,status,is_sample,created_at,updated_at) VALUES (?,?,?,?,?,'received',?,?,?)").run(id, input.assetId, input.projectId ?? null, input.filename, input.mediaType ?? null, input.sample ? 1 : 0, time, time);
    this.event(id, "received", input.sample ? "Created labelled sample job." : "Webhook or manual check received asset.");
    return { job: this.getJob(id)!, created: true };
  },
  event(jobId: string, status: string, message: string) { sql.prepare("INSERT INTO job_events (id,job_id,status,message,created_at) VALUES (?,?,?,?,?)").run(randomUUID(), jobId, status, message, now()); },
  setJob(jobId: string, status: JobStatus, fields: { durationSeconds?: number; errorCode?: string | null; errorMessage?: string | null } = {}) {
    sql.prepare("UPDATE jobs SET status=?, duration_seconds=COALESCE(?,duration_seconds), error_code=?, error_message=?, updated_at=? WHERE id=?").run(status, fields.durationSeconds ?? null, fields.errorCode ?? null, fields.errorMessage ?? null, now(), jobId);
    this.event(jobId, status, fields.errorMessage || status.replaceAll("_", " "));
  },
  setMetadata(jobId: string, metadata: { filename: string; mediaType?: string; projectId?: string }) { sql.prepare("UPDATE jobs SET filename=?,media_type=?,frameio_project_id=COALESCE(?,frameio_project_id),updated_at=? WHERE id=?").run(metadata.filename, metadata.mediaType ?? null, metadata.projectId ?? null, now(), jobId); },
  fail(jobId: string, code: string, message: string) { this.setJob(jobId, "failed", { errorCode: code, errorMessage: message }); },
  setTranscript(jobId: string, text: string, model: string, language?: string) { sql.prepare("INSERT INTO transcripts (id,job_id,text,language,provider,model,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET text=excluded.text,model=excluded.model,language=excluded.language").run(randomUUID(), jobId, text, language ?? null, "groq", model, now()); },
  saveDraft(jobId: string, draft: DraftInput) { const existing = this.getDraft(jobId); const time = now(); if (existing) sql.prepare("UPDATE drafts SET subject=?,preview_text=?,headline=?,body=?,closing=?,recipient_email=?,updated_at=? WHERE job_id=?").run(draft.subject, draft.previewText, draft.headline, draft.body, draft.closing ?? null, draft.recipientEmail ?? null, time, jobId); else sql.prepare("INSERT INTO drafts (id,job_id,subject,preview_text,headline,body,closing,recipient_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'draft',?,?)").run(randomUUID(), jobId, draft.subject, draft.previewText, draft.headline, draft.body, draft.closing ?? null, draft.recipientEmail ?? null, time, time); return this.getDraft(jobId)!; },
  getDraft(jobId: string) { const row = sql.prepare("SELECT * FROM drafts WHERE job_id=?").get(jobId) as Row | undefined; return row && toDraft(row); },
  jobDetail(id: string) { const job = this.getJob(id); if (!job) return null; const transcript = sql.prepare("SELECT text,language,model,created_at FROM transcripts WHERE job_id=?").get(id) as Row | undefined; const events = sql.prepare("SELECT status,message,created_at FROM job_events WHERE job_id=? ORDER BY created_at ASC").all(id) as Row[]; const draft = this.getDraft(id); const email = draft ? sql.prepare("SELECT status,provider_message_id,sent_at,error_message FROM email_sends WHERE draft_id=?").get(draft.id) as Row | undefined : undefined; return { job, transcript: transcript ? { text: String(transcript.text), language: transcript.language, model: transcript.model, createdAt: transcript.created_at } : null, draft, events, email: email ?? null }; },
  recordWebhook(eventId: string, assetId: string, type: string, verified: boolean) { try { sql.prepare("INSERT INTO webhook_events (provider_event_id,asset_id,event_type,verified,received_at,processing_status) VALUES (?,?,?,?,?,?)").run(eventId, assetId, type, verified ? 1 : 0, now(), "accepted"); return true; } catch { return false; } },
  beginSend(draftId: string) { const existing = sql.prepare("SELECT * FROM email_sends WHERE draft_id=?").get(draftId) as Row | undefined; if (existing?.status === "sent") return { allowed: false, reason: "already_sent" }; if (existing?.status === "sending") return { allowed: false, reason: "sending" }; const key = randomUUID(); if (existing) sql.prepare("UPDATE email_sends SET idempotency_key=?,status='sending',error_message=NULL WHERE draft_id=?").run(key, draftId); else sql.prepare("INSERT INTO email_sends (id,draft_id,idempotency_key,status) VALUES (?,?,?,'sending')").run(randomUUID(), draftId, key); sql.prepare("UPDATE drafts SET status='sending',updated_at=? WHERE id=?").run(now(), draftId); return { allowed: true, key }; },
  completeSend(draftId: string, providerId: string) { sql.prepare("UPDATE email_sends SET status='sent',provider_message_id=?,sent_at=?,error_message=NULL WHERE draft_id=?").run(providerId, now(), draftId); sql.prepare("UPDATE drafts SET status='sent',updated_at=? WHERE id=?").run(now(), draftId); },
  failSend(draftId: string, message: string) { sql.prepare("UPDATE email_sends SET status='failed',error_message=? WHERE draft_id=?").run(message, draftId); sql.prepare("UPDATE drafts SET status='draft',updated_at=? WHERE id=?").run(now(), draftId); }
};
