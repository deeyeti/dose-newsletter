import { NextRequest, NextResponse } from "next/server";
import {
  createBeehiivSubscription,
  listBeehiivSubscriptions,
  deleteBeehiivSubscription,
} from "@/lib/adapters/beehiiv";
import { isSupabaseConfigured, supabaseInsertEvent } from "@/lib/supabase";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const subscribers = await listBeehiivSubscriptions({ limit });
    return NextResponse.json({ success: true, subscribers, count: subscribers.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list Beehiiv subscribers.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const email = typeof payload.email === "string" ? payload.email.trim() : "";

  if (!email || !email.includes("@") || !email.includes(".")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  try {
    const sub = await createBeehiivSubscription(email, {
      sendWelcomeEmail: Boolean(payload.sendWelcomeEmail),
      tier: payload.tier === "premium" ? "premium" : "free",
      utmSource: "dose-engine-dashboard",
    });

    if (isSupabaseConfigured()) {
      await supabaseInsertEvent({
        id: randomUUID(),
        jobId: "beehiiv_audience",
        status: "beehiiv_subscriber_added",
        message: `Subscriber added to Beehiiv: ${email} (${sub.id}).`,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      subscriber: sub,
      message: `Subscriber ${email} added to Beehiiv successfully.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add subscriber to Beehiiv.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Subscriber id is required." }, { status: 400 });
  }

  try {
    await deleteBeehiivSubscription(id);
    return NextResponse.json({ success: true, message: "Subscriber removed." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove subscriber.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
