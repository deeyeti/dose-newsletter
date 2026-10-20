import { NextResponse } from "next/server";
import { latestFrameFile } from "@/lib/adapters/frameio";
import { store } from "@/lib/db";
import { enqueue } from "@/lib/process";
export const runtime = "nodejs";
export async function POST() { try { const file = await latestFrameFile(); const { job, created } = store.createJob({ assetId: file.id, projectId: file.projectId, filename: file.name, mediaType: file.mediaType }); if (created) enqueue(job.id); return NextResponse.json({ job, created }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Manual Frame.io check failed." }, { status: 400 }); } }
