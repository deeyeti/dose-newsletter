import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { createBeehiivPost, updateBeehiivPost, getBeehiivPost, getBeehiivCredentials } from "@/lib/adapters/beehiiv";
import { isSupabaseConfigured, supabaseJobDetail, supabaseGetBeehiivPost } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let post = store.getBeehiivPost(id);
  if (!post && isSupabaseConfigured()) {
    post = await supabaseGetBeehiivPost(id);
    if (post) store.saveBeehiivPost(post);
  }

  if (!post) {
    return NextResponse.json({ post: null }, { status: 200 });
  }

  try {
    const live = await getBeehiivPost(post.id);
    const updated = store.saveBeehiivPost({
      ...post,
      status: live.status,
      title: live.title || post.title,
      subtitle: live.subtitle || post.subtitle,
      webUrl: live.webUrl || post.webUrl,
      previewUrl: live.previewUrl || post.previewUrl,
      scheduledAt: live.scheduledAt ?? post.scheduledAt,
      publishDate: live.publishDate ?? post.publishDate,
      stats: live.stats ?? post.stats,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ success: true, post: updated });
  } catch (err) {
    return NextResponse.json({
      success: true,
      post,
      warning: err instanceof Error ? err.message : "Could not refresh live stats",
    });
  }
}

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
    let status: "draft" | "confirmed" = "draft";
    let scheduledAt: string | undefined = undefined;

    if (payload.action === "publish" || payload.status === "confirmed") {
      status = "confirmed";
      scheduledAt = undefined;
    } else if (payload.action === "schedule" && payload.scheduledAt) {
      status = "confirmed";
      scheduledAt = new Date(payload.scheduledAt).toISOString();
    } else {
      status = "draft";
      scheduledAt = undefined;
    }

    const { publicationId } = await getBeehiivCredentials();
    const existingPost = detail?.beehiivPost || store.getBeehiivPost(id);
    let postResult: { id: string; previewUrl?: string; webUrl?: string };
    let isUpdate = false;

    if (existingPost?.id) {
      isUpdate = true;
      postResult = await updateBeehiivPost(existingPost.id, draft, { status, scheduledAt });
    } else {
      postResult = await createBeehiivPost(draft, { status, scheduledAt });
    }

    const savedPost = store.saveBeehiivPost({
      id: postResult.id,
      jobId: id,
      draftId: draft.id,
      publicationId,
      status,
      title: draft.headline?.trim() || draft.subject?.trim(),
      subtitle: draft.previewText?.trim(),
      webUrl: postResult.webUrl || existingPost?.webUrl,
      previewUrl: postResult.previewUrl || existingPost?.previewUrl,
      scheduledAt: scheduledAt || null,
      stats: existingPost?.stats || null,
      createdAt: existingPost?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const actionDesc =
      status === "confirmed"
        ? scheduledAt
          ? `scheduled for ${scheduledAt}`
          : "published immediately"
        : isUpdate
        ? "updated in Beehiiv"
        : "synced to Beehiiv as draft";

    store.event(id, "beehiiv_synced", `Post ${postResult.id} ${actionDesc}.`);

    return NextResponse.json({
      success: true,
      postId: savedPost.id,
      previewUrl: savedPost.previewUrl,
      webUrl: savedPost.webUrl,
      post: savedPost,
      isUpdate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync to Beehiiv.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

