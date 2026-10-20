import { NextResponse } from "next/server";
import { publicConfiguration } from "@/lib/env";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ configuration: publicConfiguration() }); }
