import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { store } from "@/lib/db";
import { enqueue } from "@/lib/process";
export const runtime = "nodejs";
export function POST() { const { job } = store.createJob({ assetId: `sample-${randomUUID()}`, filename: "sample-interview.mp4", mediaType: "video/mp4", sample: true }); enqueue(job.id); return NextResponse.json({ job }); }
