import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { store } from "@/lib/db";
import { processSample } from "@/lib/process";
import { isSupabaseConfigured, supabaseUpsertJob } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST() {
  const { job } = store.createJob({
    assetId: `sample-${randomUUID()}`,
    filename: "sample-interview.mp4",
    mediaType: "video/mp4",
    sample: true,
  });

  if (isSupabaseConfigured()) {
    await supabaseUpsertJob(job);
  }

  await processSample(job.id);
  const detail = store.jobDetail(job.id);
  return NextResponse.json({ job: detail?.job || job, draft: detail?.draft });
}
