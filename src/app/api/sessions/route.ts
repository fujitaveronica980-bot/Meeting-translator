import { NextRequest, NextResponse } from "next/server";
import { runSession } from "@/lib/pipeline";
import { listSessions } from "@/lib/session-store";
import type { SessionMode } from "@/lib/types";

const VALID_MODES: SessionMode[] = ["seminar", "meeting", "casual"];

export async function GET() {
  return NextResponse.json({ sessions: await listSessions() });
}

export async function POST(req: NextRequest) {
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
}
