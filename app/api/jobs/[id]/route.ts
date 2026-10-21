import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { isSupabaseConfigured, supabaseJobDetail } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail = store.jobDetail(id);
  if (!detail && isSupabaseConfigured()) {
    const remote = await supabaseJobDetail(id);
    if (remote) {
      store.seedDetail(remote);
      detail = remote;
    }
  }
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail = store.jobDetail(id);
  if (!detail && isSupabaseConfigured()) {
    const remote = await supabaseJobDetail(id);
    if (remote) {
      store.seedDetail(remote);
      detail = remote;
    }
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
  return NextResponse.json({ draft: saved });
}


