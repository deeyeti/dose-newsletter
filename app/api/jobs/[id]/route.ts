import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import {
  isSupabaseConfigured,
  supabaseJobDetail,
  supabaseUpsertDraft,
  supabaseDeleteJob,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: any = null;

  if (isSupabaseConfigured()) {
    try {
      const remote = await supabaseJobDetail(id);
      if (remote) {
        detail = remote;
        const local = store.jobDetail(id);
        if (local) {
          if (!detail.transcript && local.transcript) detail.transcript = local.transcript;
          if (!detail.draft && local.draft) detail.draft = local.draft;
          if ((!detail.events || detail.events.length === 0) && local.events && local.events.length > 0) {
            detail.events = local.events;
          }
          if (!detail.email && local.email) detail.email = local.email;
        }
        store.seedDetail(detail);
      }
    } catch (err) {
      console.warn("[/api/jobs/[id] Supabase query warning]:", err);
    }
  }

  if (!detail) {
    detail = store.jobDetail(id);
  }

  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: any = null;
  if (isSupabaseConfigured()) {
    try {
      const remote = await supabaseJobDetail(id);
      if (remote) {
        store.seedDetail(remote);
        detail = remote;
      }
    } catch {}
  }
  if (!detail) {
    detail = store.jobDetail(id);
  }

  const job = detail?.job || store.getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await request.json();
  const fields = ["subject", "previewText", "headline", "body", "closing", "recipientEmail"] as const;
  if (fields.some((key) => key in body && typeof body[key] !== "string")) {
    return NextResponse.json({ error: "Draft fields must be text." }, { status: 400 });
  }

  const existingDraft = detail?.draft || store.getDraft(id);
  const saved = store.saveDraft(id, {
    subject: body.subject ?? existingDraft?.subject ?? "Newsletter Draft",
    previewText: body.previewText ?? existingDraft?.previewText ?? "",
    headline: body.headline ?? existingDraft?.headline ?? "Newsletter",
    body: body.body ?? existingDraft?.body ?? "",
    closing: body.closing ?? existingDraft?.closing ?? undefined,
    recipientEmail: body.recipientEmail ?? existingDraft?.recipientEmail ?? undefined,
  });

  if (isSupabaseConfigured()) {
    await supabaseUpsertDraft(saved).catch((err) =>
      console.warn("[/api/jobs/[id] PATCH supabase save error]:", err)
    );
  }

  return NextResponse.json({ draft: saved });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  store.deleteJob(id);
  if (isSupabaseConfigured()) {
    await supabaseDeleteJob(id).catch((err) =>
      console.warn("[/api/jobs/[id] DELETE supabase error]:", err)
    );
  }
  return NextResponse.json({ deleted: true, id });
}




