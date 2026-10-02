import { NextResponse } from "next/server";
import { listSessions } from "@/lib/session-store";

// Listing only — new recordings are uploaded to /api/upload.

export async function GET() {
  try {
    return NextResponse.json({ sessions: await listSessions() });
  } catch (err) {
    // A broken persistence config (e.g. malformed Firebase credentials)
    // shouldn't take the whole app down on every page load — degrade to an
    // empty history rather than a hard failure.
    console.error("Failed to list sessions:", err);
    return NextResponse.json({ sessions: [] });
  }
}
