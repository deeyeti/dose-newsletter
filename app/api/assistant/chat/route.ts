import { NextRequest, NextResponse } from "next/server";
import { askAssistant, ChatMessage } from "@/lib/assistant/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "Invalid request: 'messages' array is required." },
        { status: 400 }
      );
    }

    const response = await askAssistant(body.messages);
    return NextResponse.json(response);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Assistant request failed";
    console.error("[Assistant Error]:", error);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
