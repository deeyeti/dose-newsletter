import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env, supabaseUrl, supabaseServiceRoleKey, supabaseAnonKey } from "@/lib/env";
import type { Job, NewsletterDraft } from "@/lib/types";

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = supabaseUrl ? supabaseUrl() : env("SUPABASE_URL");
  const key = (supabaseServiceRoleKey ? supabaseServiceRoleKey() : env("SUPABASE_SERVICE_ROLE_KEY")) || (supabaseAnonKey ? supabaseAnonKey() : env("SUPABASE_ANON_KEY"));
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
  }
  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

export type ReelRow = {
  id: string;
  permalink?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  published_at?: string | null;
  transcript: string;
  summary?: string | null;
  key_themes?: string[] | null;
  created_at?: string;
};

export type ReelMetricRow = {
  id?: string;
  reel_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement_rate?: number;
  recorded_at?: string;
};

export type ReelEmbeddingRow = {
  id?: string;
  reel_id: string;
  chunk_text: string;
  speaker_timestamp?: string | null;
  embedding?: number[];
};


function getCredentials() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return {
    url: url.replace(/\/+$/, ""),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

export function isSupabaseConfigured(): boolean {
  return getCredentials() !== null;
}

export async function supabaseListJobs(): Promise<Job[] | null> {
  const creds = getCredentials();
  if (!creds) return null;

  try {
    const res = await fetch(
      `${creds.url}/rest/v1/jobs?select=*,drafts(subject,recipient_email)&order=created_at.desc&limit=50`,
      { headers: creds.headers, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    return data.map((r) => {
      const draft = Array.isArray(r.drafts) ? r.drafts[0] : r.drafts;
      return {
        id: String(r.id),
        frameioAssetId: String(r.frameio_asset_id),
        frameioProjectId: r.frameio_project_id ? String(r.frameio_project_id) : undefined,
        filename: String(r.filename),
        mediaType: r.media_type ? String(r.media_type) : undefined,
        durationSeconds: r.duration_seconds == null ? undefined : Number(r.duration_seconds),
        status: r.status,
        isSample: Boolean(r.is_sample),
        errorCode: r.error_code ? String(r.error_code) : undefined,
        errorMessage: r.error_message ? String(r.error_message) : undefined,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
        draftSubject: draft?.subject ? String(draft.subject) : undefined,
        recipientEmail: draft?.recipient_email ? String(draft.recipient_email) : undefined,
      };
    });
  } catch {
    return null;
  }
}

export async function supabaseJobDetail(jobId: string): Promise<any | null> {
  const creds = getCredentials();
  if (!creds) return null;

  try {
    const res = await fetch(
      `${creds.url}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}&select=*,transcripts(*),drafts(*,email_sends(*)),job_events(*)&job_events.order=created_at.asc`,
      { headers: creds.headers, cache: "no-store" }
    );
    if (!res.ok) return null;
    const list = (await res.json()) as any[];
    if (!list.length) return null;
    const r = list[0];

    const transcript = Array.isArray(r.transcripts) ? r.transcripts[0] : r.transcripts;
    const draft = Array.isArray(r.drafts) ? r.drafts[0] : r.drafts;
    const email = draft?.email_sends
      ? (Array.isArray(draft.email_sends) ? draft.email_sends[0] : draft.email_sends)
      : (Array.isArray(r.email_sends) ? r.email_sends[0] : r.email_sends);
    const events = Array.isArray(r.job_events) ? r.job_events : [];


    const job: Job = {
      id: String(r.id),
      frameioAssetId: String(r.frameio_asset_id),
      frameioProjectId: r.frameio_project_id ? String(r.frameio_project_id) : undefined,
      filename: String(r.filename),
      mediaType: r.media_type ? String(r.media_type) : undefined,
      durationSeconds: r.duration_seconds == null ? undefined : Number(r.duration_seconds),
      status: r.status,
      isSample: Boolean(r.is_sample),
      errorCode: r.error_code ? String(r.error_code) : undefined,
      errorMessage: r.error_message ? String(r.error_message) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };

    return {
      job,
      transcript: transcript
        ? {
            text: String(transcript.text),
            language: transcript.language ? String(transcript.language) : undefined,
            model: String(transcript.model),
            createdAt: String(transcript.created_at),
          }
        : null,
      draft: draft
        ? {
            id: String(draft.id),
            jobId: String(draft.job_id),
            subject: String(draft.subject),
            previewText: String(draft.preview_text),
            headline: String(draft.headline),
            body: String(draft.body),
            closing: draft.closing ? String(draft.closing) : undefined,
            recipientEmail: draft.recipient_email ? String(draft.recipient_email) : undefined,
            status: String(draft.status) as NewsletterDraft["status"],
            updatedAt: String(draft.updated_at),
          }
        : null,
      events: events.map((e: any) => ({
        id: e.id ? String(e.id) : undefined,
        status: String(e.status),
        message: String(e.message),
        created_at: String(e.created_at),
      })),
      email: email
        ? {
            status: String(email.status),
            provider_message_id: email.provider_message_id ? String(email.provider_message_id) : null,
            sent_at: email.sent_at ? String(email.sent_at) : null,
            error_message: email.error_message ? String(email.error_message) : null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export async function supabaseUpsertJob(job: Job): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    await fetch(`${creds.url}/rest/v1/jobs`, {
      method: "POST",
      headers: { ...creds.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: job.id,
        frameio_asset_id: job.frameioAssetId,
        frameio_project_id: job.frameioProjectId ?? null,
        filename: job.filename,
        media_type: job.mediaType ?? null,
        duration_seconds: job.durationSeconds ?? null,
        status: job.status,
        is_sample: job.isSample,
        error_code: job.errorCode ?? null,
        error_message: job.errorMessage ?? null,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      }),
    });
  } catch (err) {
    console.warn("[supabase] upsertJob failed:", err);
  }
}

export async function supabaseFindTranscript(query: {
  jobId?: string;
  assetId?: string;
  filename?: string;
}): Promise<{ text: string; language?: string; model: string; createdAt: string } | null> {
  const creds = getCredentials();
  if (!creds) return null;

  try {
    // 1. Try finding by jobId directly
    if (query.jobId) {
      const res = await fetch(
        `${creds.url}/rest/v1/transcripts?job_id=eq.${encodeURIComponent(query.jobId)}&select=text,language,model,created_at&limit=1`,
        { headers: creds.headers, cache: "no-store" }
      );
      if (res.ok) {
        const rows = (await res.json()) as any[];
        if (rows.length && rows[0].text) {
          return {
            text: String(rows[0].text),
            language: rows[0].language ? String(rows[0].language) : undefined,
            model: String(rows[0].model),
            createdAt: String(rows[0].created_at),
          };
        }
      }
    }

    // 2. Try finding by frameio_asset_id
    if (query.assetId) {
      const res = await fetch(
        `${creds.url}/rest/v1/transcripts?frameio_asset_id=eq.${encodeURIComponent(query.assetId)}&select=text,language,model,created_at&order=created_at.desc&limit=1`,
        { headers: creds.headers, cache: "no-store" }
      );
      if (res.ok) {
        const rows = (await res.json()) as any[];
        if (rows.length && rows[0].text) {
          return {
            text: String(rows[0].text),
            language: rows[0].language ? String(rows[0].language) : undefined,
            model: String(rows[0].model),
            createdAt: String(rows[0].created_at),
          };
        }
      }

      // Also try via jobs join
      const joinRes = await fetch(
        `${creds.url}/rest/v1/jobs?frameio_asset_id=eq.${encodeURIComponent(query.assetId)}&select=id,transcripts(text,language,model,created_at)&limit=1`,
        { headers: creds.headers, cache: "no-store" }
      );
      if (joinRes.ok) {
        const rows = (await joinRes.json()) as any[];
        const t = rows.length ? (Array.isArray(rows[0].transcripts) ? rows[0].transcripts[0] : rows[0].transcripts) : null;
        if (t && t.text) {
          return {
            text: String(t.text),
            language: t.language ? String(t.language) : undefined,
            model: String(t.model),
            createdAt: String(t.created_at),
          };
        }
      }
    }

    // 3. Try finding by filename
    if (query.filename) {
      const res = await fetch(
        `${creds.url}/rest/v1/transcripts?filename=eq.${encodeURIComponent(query.filename)}&select=text,language,model,created_at&order=created_at.desc&limit=1`,
        { headers: creds.headers, cache: "no-store" }
      );
      if (res.ok) {
        const rows = (await res.json()) as any[];
        if (rows.length && rows[0].text) {
          return {
            text: String(rows[0].text),
            language: rows[0].language ? String(rows[0].language) : undefined,
            model: String(rows[0].model),
            createdAt: String(rows[0].created_at),
          };
        }
      }

      // Also try via jobs join
      const joinRes = await fetch(
        `${creds.url}/rest/v1/jobs?filename=eq.${encodeURIComponent(query.filename)}&select=id,transcripts(text,language,model,created_at)&order=created_at.desc&limit=1`,
        { headers: creds.headers, cache: "no-store" }
      );
      if (joinRes.ok) {
        const rows = (await joinRes.json()) as any[];
        const t = rows.length ? (Array.isArray(rows[0].transcripts) ? rows[0].transcripts[0] : rows[0].transcripts) : null;
        if (t && t.text) {
          return {
            text: String(t.text),
            language: t.language ? String(t.language) : undefined,
            model: String(t.model),
            createdAt: String(t.created_at),
          };
        }
      }
    }
  } catch (err) {
    console.warn("[supabase] findTranscript query failed:", err);
  }

  return null;
}

export async function supabaseUpsertTranscript(item: {
  id: string;
  jobId: string;
  text: string;
  language?: string;
  model: string;
  assetId?: string;
  filename?: string;
  createdAt: string;
}): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    await fetch(`${creds.url}/rest/v1/transcripts`, {
      method: "POST",
      headers: { ...creds.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: item.id,
        job_id: item.jobId,
        frameio_asset_id: item.assetId ?? null,
        filename: item.filename ?? null,
        text: item.text,
        language: item.language ?? null,
        provider: "groq",
        model: item.model,
        created_at: item.createdAt,
      }),
    });
  } catch (err) {
    console.warn("[supabase] upsertTranscript failed:", err);
  }
}


export async function supabaseUpsertDraft(draft: NewsletterDraft): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    await fetch(`${creds.url}/rest/v1/drafts`, {
      method: "POST",
      headers: { ...creds.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: draft.id,
        job_id: draft.jobId,
        subject: draft.subject,
        preview_text: draft.previewText,
        headline: draft.headline,
        body: draft.body,
        closing: draft.closing ?? null,
        recipient_email: draft.recipientEmail ?? null,
        status: draft.status,
        updated_at: draft.updatedAt,
      }),
    });
  } catch (err) {
    console.warn("[supabase] upsertDraft failed:", err);
  }
}

export async function supabaseUpsertEmailSend(send: {
  id: string;
  draftId: string;
  jobId?: string;
  idempotencyKey: string;
  status: string;
  providerMessageId?: string;
  sentAt?: string;
  errorMessage?: string;
}): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    await fetch(`${creds.url}/rest/v1/email_sends`, {
      method: "POST",
      headers: { ...creds.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: send.id,
        draft_id: send.draftId,
        job_id: send.jobId ?? null,
        idempotency_key: send.idempotencyKey,
        provider_message_id: send.providerMessageId ?? null,
        sent_at: send.sentAt ?? null,
        error_message: send.errorMessage ?? null,
        status: send.status,
      }),
    });
  } catch (err) {
    console.warn("[supabase] upsertEmailSend failed:", err);
  }
}


export async function supabaseInsertEvent(event: {
  id: string;
  jobId: string;
  status: string;
  message: string;
  createdAt: string;
}): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    await fetch(`${creds.url}/rest/v1/job_events`, {
      method: "POST",
      headers: creds.headers,
      body: JSON.stringify({
        id: event.id,
        job_id: event.jobId,
        status: event.status,
        message: event.message,
        created_at: event.createdAt,
      }),
    });
  } catch (err) {
    console.warn("[supabase] insertEvent failed:", err);
  }
}

export async function supabaseDeleteJob(jobId: string): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    await fetch(`${creds.url}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: creds.headers,
    });
  } catch (err) {
    console.warn("[supabase] deleteJob failed:", err);
  }
}

export async function supabaseRecordWebhook(
  eventId: string,
  assetId: string,
  type: string,
  verified: boolean
): Promise<boolean> {
  const creds = getCredentials();
  if (!creds) return true;

  try {
    const res = await fetch(`${creds.url}/rest/v1/webhook_events`, {
      method: "POST",
      headers: creds.headers,
      body: JSON.stringify({
        provider_event_id: eventId,
        asset_id: assetId,
        event_type: type,
        verified,
        received_at: new Date().toISOString(),
        processing_status: "accepted",
      }),
    });
    return res.status === 201 || res.status === 200;
  } catch {
    return true;
  }
}

