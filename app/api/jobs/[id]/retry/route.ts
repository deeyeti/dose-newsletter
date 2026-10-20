import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { enqueue } from "@/lib/process";
export const runtime = "nodejs";
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const job = store.getJob(id); if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 }); if (job.status === "sent") return NextResponse.json({ error: "A sent job cannot be reprocessed." }, { status: 409 }); enqueue(id); return NextResponse.json({ accepted: true }); }
