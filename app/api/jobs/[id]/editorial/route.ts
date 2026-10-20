import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { generateHeadlineAngles, adjustTone, factCheckDraft } from "@/lib/adapters/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = store.jobDetail(id);
  if (!detail || !detail.transcript || !detail.draft) {
    return NextResponse.json({ error: "Job transcript and draft are required for editorial assistance." }, { status: 400 });
  }

  const payload = await request.json().catch(() => ({}));
  const action = payload.action as string;

  try {
    if (action === "headlines") {
      const angles = await generateHeadlineAngles(detail.transcript.text, detail.draft.subject, detail.draft.headline);
      return NextResponse.json({ angles });
    }

    if (action === "tone") {
      const tone = (payload.tone || "warmer") as "warmer" | "punchier" | "more_reflective";
      const refined = await adjustTone(detail.transcript.text, detail.draft, tone);
      return NextResponse.json({ draft: refined });
    }

    if (action === "factcheck") {
      const check = await factCheckDraft(detail.transcript.text, detail.draft);
      return NextResponse.json({ check });
    }

    return NextResponse.json({ error: "Invalid editorial action. Must be 'headlines', 'tone', or 'factcheck'." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Editorial processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
