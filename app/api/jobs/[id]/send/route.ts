import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { deliverEmail } from "@/lib/adapters/email";
import { isSupabaseConfigured, supabaseJobDetail } from "@/lib/supabase";

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
  if (payload.confirm !== true) return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 400 });

  let draft = detail?.draft || store.getDraft(id);
  if (payload.draft && typeof payload.draft === "object") {
    draft = store.saveDraft(id, payload.draft);
  }

  if (!draft) return NextResponse.json({ error: "Draft not found. Please save a draft before sending." }, { status: 404 });
  if (!draft.recipientEmail || !/^\S+@\S+\.\S+$/.test(draft.recipientEmail)) {
    return NextResponse.json({ error: "Enter a valid recipient email before sending." }, { status: 400 });
  }
  const send = store.beginSend(draft.id);
  if (!send.allowed) {
    return NextResponse.json(
      { error: send.reason === "already_sent" ? "This newsletter was already sent." : "A send is already in progress." },
      { status: 409 }
    );
  }
  store.setJob(id, "sending");
  try {
    const providerId = await deliverEmail(draft, send.key!);
    store.completeSend(draft.id, providerId);
    store.setJob(id, "sent");
    return NextResponse.json({ sent: true, providerMessageId: providerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed.";
    store.failSend(draft.id, message);
    store.fail(id, "EMAIL_FAILED", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}


