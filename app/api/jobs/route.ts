import { NextResponse } from "next/server";
import { store } from "@/lib/db";
export const runtime = "nodejs";
export function GET() { return NextResponse.json({ jobs: store.listJobs() }); }
