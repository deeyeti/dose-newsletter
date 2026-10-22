import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { store } from "@/lib/db";
import { createBeehiivPost } from "@/lib/adapters/beehiiv";
import { isSupabaseConfigured, supabaseJobDetail, supabaseInsertEvent } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail = store.jobDetail(id);
  if (!detail && isSupabaseConfigured()) {
    const remote = await supabaseJobDetail(id);
    if (remote) {
      store.seedDetail(remote);
      detail = remote;
    }
  }

  const payload = await request.json().catch(() => ({}));

  let draft = detail?.draft || store.getDraft(id);
  if (payload.draft && typeof payload.draft === "object") {
    draft = store.saveDraft(id, payload.draft);
  }

  if (!draft) {
    return NextResponse.json({ error: "Draft not found. Please create or save a draft first." }, { status: 404 });
  }

  try {
    const status = payload.status === "confirmed" ? "confirmed" : "draft";
    const post = await createBeehiivPost(draft, { status });

    if (isSupabaseConfigured()) {
      await supabaseInsertEvent({
        id: randomUUID(),
        jobId: id,
        status: "beehiiv_synced",
        message: `Draft synced to Beehiiv (${post.id}).`,
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      postId: post.id,
      previewUrl: post.previewUrl,
      webUrl: post.webUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync to Beehiiv.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
