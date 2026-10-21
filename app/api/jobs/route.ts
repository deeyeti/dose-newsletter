import { NextResponse } from "next/server";
import { store } from "@/lib/db";
import { listFrameFiles } from "@/lib/adapters/frameio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let lastSync = 0;

export async function GET() {
  try {
    const now = Date.now();
    // Cache sync for 3 seconds to avoid exhausting rate limits on frequent dashboard polls
    if (now - lastSync > 3000) {
      lastSync = now;
      try {
        const frameFiles = await listFrameFiles();
        if (frameFiles && frameFiles.length > 0) {
          const currentAssetIds = new Set(frameFiles.map((f) => f.id));

          // Ensure every active file in the Frame.io folder is registered as a job
          for (const file of frameFiles) {
            store.createJob({
              assetId: file.id,
              projectId: file.projectId,
              filename: file.name,
              mediaType: file.mediaType,
            });
          }

          // Clean up any stale jobs that were removed/deleted from the Frame.io folder
          const allJobs = store.listJobs();
          for (const job of allJobs) {
            if (!job.isSample && !currentAssetIds.has(job.frameioAssetId)) {
              store.deleteJob(job.id);
            }
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
