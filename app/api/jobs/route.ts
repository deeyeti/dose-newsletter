import { NextResponse } from "next/server";
import { store } from "@/lib/db";
import { listFrameFiles } from "@/lib/adapters/frameio";
import { isSupabaseConfigured, supabaseListJobs } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let lastSync = 0;

export async function GET() {
  try {
    // If Supabase is configured, hydrate local store from remote so all serverless instances stay in sync
    if (isSupabaseConfigured()) {
      try {
        const remoteJobs = await supabaseListJobs();
        if (remoteJobs && remoteJobs.length > 0) {
          for (const rj of remoteJobs) {
            store.seedJob(rj);
          }
        }
      } catch (sbErr) {
        console.warn("[/api/jobs supabase sync warning]:", sbErr);
      }
    }

    const now = Date.now();
    // Cache sync for 3 seconds to avoid exhausting rate limits on frequent dashboard polls
    if (now - lastSync > 3000) {
      lastSync = now;
      try {
        const frameFiles = await listFrameFiles();
        if (frameFiles && frameFiles.length > 0) {
          // Ensure every active file in the Frame.io folder is registered as a job
          for (const file of frameFiles) {
            store.createJob({
              assetId: file.id,
              projectId: file.projectId,
              filename: file.name,
              mediaType: file.mediaType,
            });
          }
        }
      } catch (syncErr) {
        console.warn("[/api/jobs sync warning]:", syncErr);
      }
    }

    const jobs = store.listJobs();
    return NextResponse.json({ jobs });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/jobs error]:", error);
    return NextResponse.json({ jobs: [], error: message });
  }
}
