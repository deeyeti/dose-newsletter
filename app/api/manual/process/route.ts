import { NextResponse } from "next/server";
import { listFrameFiles, latestFrameFile } from "@/lib/adapters/frameio";
import { store } from "@/lib/db";
import { enqueue } from "@/lib/process";

export const runtime = "nodejs";

export async function POST() {
  try {
    const files = await listFrameFiles();
    if (!files.length) {
      // Fallback to latestFrameFile if list was empty
      const file = await latestFrameFile();
      const { job, created } = store.createJob({
        assetId: file.id,
        projectId: file.projectId,
        filename: file.name,
        mediaType: file.mediaType,
      });
      if (created || job.status === "received") {
        enqueue(job.id);
      }
      return NextResponse.json({ job, created, message: "Checked Frame.io." });
    }

    let queuedCount = 0;
    let latestJob = null;


    for (const file of files) {
      const { job, created } = store.createJob({
        assetId: file.id,
        projectId: file.projectId,
        filename: file.name,
        mediaType: file.mediaType,
      });

      if (created || job.status === "received") {
        enqueue(job.id);
        queuedCount++;
      }
      latestJob = job;
    }

    return NextResponse.json({
      message: `Frame.io synced: ${files.length} video(s) found, ${queuedCount} queued.`,
      job: latestJob,
      count: files.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Manual Frame.io check failed." },
      { status: 400 }
    );
  }
}
