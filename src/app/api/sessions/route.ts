import { NextRequest, NextResponse } from "next/server";
import { runSession } from "@/lib/pipeline";
import { listSessions } from "@/lib/session-store";
import type { SessionMode } from "@/lib/types";

const VALID_MODES: SessionMode[] = ["seminar", "meeting", "casual"];

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const mode = form.get("mode");
  const file = form.get("audio");

  const resolvedMode: SessionMode = VALID_MODES.includes(mode as SessionMode)
    ? (mode as SessionMode)
    : "meeting";

  // No file is fine: the mock STT provider ignores audio content entirely,
  // so this doubles as the app's zero-setup "try a sample recording" path.
  let audio = Buffer.alloc(0);
  let filename: string | undefined;
  let mimeType: string | undefined;
  if (file instanceof File) {
    audio = Buffer.from(await file.arrayBuffer());
    filename = file.name;
    mimeType = file.type || undefined;
  }

  const session = await runSession({ audio, mode: resolvedMode, filename, mimeType });

  return NextResponse.json(session, { status: session.status === "error" ? 502 : 200 });
}
