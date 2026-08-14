import { NextRequest, NextResponse } from "next/server";
import { runSession } from "@/lib/pipeline";
import { listSessions } from "@/lib/session-store";
import type { SessionMode } from "@/lib/types";

const VALID_MODES: SessionMode[] = ["seminar", "meeting", "casual"];

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

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const mode = form.get("mode");
    const file = form.get("audio");
    // Explicit flag rather than inferring "sample" from "no file attached" —
    // that inference broke once real STT keys were configured: a real
    // provider correctly rejects an empty audio buffer instead of silently
    // ignoring it the way mock does.
    const useSample = form.get("sample") === "true";

    const resolvedMode: SessionMode = VALID_MODES.includes(mode as SessionMode)
      ? (mode as SessionMode)
      : "meeting";

    let audio = Buffer.alloc(0);
    let filename: string | undefined;
    let mimeType: string | undefined;
    if (file instanceof File) {
      audio = Buffer.from(await file.arrayBuffer());
      filename = file.name;
      mimeType = file.type || undefined;
    }

    const session = await runSession({ audio, mode: resolvedMode, filename, mimeType, useSample });

    return NextResponse.json(session, { status: session.status === "error" ? 502 : 200 });
  } catch (err) {
    // runSession() already catches its own STT/LLM/persistence errors and
    // returns a normal error-status Session — this is the last-resort net
    // for anything outside that (e.g. malformed form data), so the client
    // always gets a real JSON body back instead of a broken response it
    // can't even parse.
    console.error("Unhandled error in POST /api/sessions:", err);
    return NextResponse.json(
      { status: "error", errorMessage: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
