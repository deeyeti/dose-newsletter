import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { verifyFrameioSignature } from "@/lib/adapters/frameio";
import { store } from "@/lib/db";
import { processLiveJob } from "@/lib/process";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const timestamp = request.headers.get("x-frameio-request-timestamp");
  const signature = request.headers.get("x-frameio-signature");

  const verified = verifyFrameioSignature(raw, timestamp, signature);
  if (!verified) {
    return NextResponse.json({ error: "Invalid Frame.io webhook signature." }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (event.type !== "file.ready" || event.resource?.type !== "file" || !event.resource?.id) {
    return NextResponse.json({ ignored: true });
  }

  const eventId = event.id || createHash("sha256").update(raw).digest("hex");
  if (!store.recordWebhook(eventId, event.resource.id, event.type, true)) {
    return NextResponse.json({ duplicate: true });
  }

  const { job, created } = store.createJob({
    assetId: event.resource.id,
    projectId: event.project?.id,
    filename: "Frame.io file (fetching metadata)",
  });

  if (created) {
    if (typeof after === "function") {
      after(async () => {
        try {
          await processLiveJob(job.id);
        } catch (err) {
          console.error(`[webhook] Background processing failed for ${job.id}:`, err);
        }
      });
    } else {
      void processLiveJob(job.id);
    }
  }

  return NextResponse.json({ accepted: true, jobId: job.id }, { status: 202 });
}
