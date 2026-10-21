import { NextResponse } from "next/server";
import { store } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const jobs = store.listJobs();
    return NextResponse.json({ jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/jobs error]:", error);
    return NextResponse.json({ jobs: [], error: message });
  }
}
