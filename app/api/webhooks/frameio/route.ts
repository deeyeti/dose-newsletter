import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { verifyFrameioSignature } from "@/lib/adapters/frameio";
import { store } from "@/lib/db";
import { enqueue } from "@/lib/process";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { const raw = await request.text(); const verified = verifyFrameioSignature(raw, request.headers.get("x-frameio-request-timestamp"), request.headers.get("x-frameio-signature")); if (!verified) return NextResponse.json({ error: "Invalid Frame.io webhook signature." }, { status: 401 }); let event: any; try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 }); } if (event.type !== "file.ready" || event.resource?.type !== "file" || !event.resource?.id) return NextResponse.json({ ignored: true }); const eventId = event.id || createHash("sha256").update(raw).digest("hex"); if (!store.recordWebhook(eventId, event.resource.id, event.type, true)) return NextResponse.json({ duplicate: true }); const { job, created } = store.createJob({ assetId: event.resource.id, projectId: event.project?.id, filename: "Frame.io file (fetching metadata)" }); if (created) enqueue(job.id); return NextResponse.json({ accepted: true, jobId: job.id }, { status: 202 }); }
