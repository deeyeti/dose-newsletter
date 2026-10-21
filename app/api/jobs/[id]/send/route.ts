import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { store } from "@/lib/db";
import { deliverEmail } from "@/lib/adapters/email";
import {
  isSupabaseConfigured,
  supabaseJobDetail,
  supabaseUpsertJob,
  supabaseUpsertDraft,
  supabaseUpsertEmailSend,
  supabaseInsertEvent,
} from "@/lib/supabase";

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

  const allowResend = payload.resend === true;
  const send = store.beginSend(draft.id, allowResend);
  if (!send.allowed) {
    return NextResponse.json(
      { error: send.reason === "already_sent" ? "This newsletter was already sent." : "A send is already in progress." },
      { status: 409 }
    );
  }

  const sendStartTime = new Date().toISOString();
  store.setJob(id, "sending");
  if (isSupabaseConfigured()) {
    const jobSending = store.getJob(id);
    if (jobSending) await supabaseUpsertJob(jobSending);
    await supabaseUpsertEmailSend({
      id: randomUUID(),
      draftId: draft.id,
      jobId: id,
      idempotencyKey: send.key!,
      status: "sending",
    });
    await supabaseInsertEvent({
      id: randomUUID(),
      jobId: id,
      status: "sending",
      message: `Sending newsletter to ${draft.recipientEmail}...`,
      createdAt: sendStartTime,
    });
  }

  try {
    const providerId = await deliverEmail(draft, send.key!);
    const sentTime = new Date().toISOString();

    store.completeSend(draft.id, providerId);
    store.setJob(id, "sent");

    if (isSupabaseConfigured()) {
      const jobSent = store.getJob(id);
      if (jobSent) await supabaseUpsertJob(jobSent);
      const draftSent = store.getDraft(id);
      if (draftSent) {
        await supabaseUpsertDraft({ ...draftSent, status: "sent", updatedAt: sentTime });
      }
      await supabaseUpsertEmailSend({
        id: randomUUID(),
        draftId: draft.id,
        jobId: id,
        idempotencyKey: send.key || "sent",
        status: "sent",
        providerMessageId: providerId,
        sentAt: sentTime,
      });
      await supabaseInsertEvent({
        id: randomUUID(),
        jobId: id,
        status: "sent",
        message: `Newsletter delivered via provider (ID: ${providerId}).`,
        createdAt: sentTime,
      });
    }

    return NextResponse.json({ sent: true, providerMessageId: providerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed.";
    const failTime = new Date().toISOString();
    store.failSend(draft.id, message);
    store.fail(id, "EMAIL_FAILED", message);

    if (isSupabaseConfigured()) {
      const jobFailed = store.getJob(id);
      if (jobFailed) await supabaseUpsertJob(jobFailed);
      await supabaseUpsertEmailSend({
        id: randomUUID(),
        draftId: draft.id,
        jobId: id,
        idempotencyKey: send.key || "failed",
        status: "failed",
        errorMessage: message,
      });
      await supabaseInsertEvent({
        id: randomUUID(),
        jobId: id,
        status: "failed",
        message: `Email delivery failed: ${message}`,
        createdAt: failTime,
      });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
