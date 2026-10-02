import { after, NextResponse } from "next/server";
import { keepAwakeWhile } from "@/lib/keep-awake";
import { loadTranscript, reanalyzeSession } from "@/lib/pipeline";
import { getSession, saveSession } from "@/lib/session-store";

/**
 * Rebuilds a session's report from its stored transcript. Responds straight
 * away, like an upload; the page polls the session for the new report.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status !== "ready" && session.status !== "error") {
      return NextResponse.json({ error: "This recording is still being processed." }, { status: 409 });
    }
    const transcript = await loadTranscript(id);
    if (!transcript) {
      return NextResponse.json(
        { error: "This recording has no stored transcript — upload the audio again." },
        { status: 409 }
      );
    }

    let reader = "";
    try {
      reader = decodeURIComponent(req.headers.get("x-reader") ?? "").slice(0, 200);
    } catch {
      // malformed encoding: carry on without it
    }

    session.status = "analyzing";
    session.heartbeatAt = new Date().toISOString();
    delete session.errorMessage;
    await saveSession(session);

    after(() => keepAwakeWhile(() => reanalyzeSession(session, transcript, reader)));

    return NextResponse.json(session, { status: 202 });
  } catch (err) {
    console.error(`Failed to re-analyze session ${id}:`, err);
    return NextResponse.json({ error: "Failed to start the re-analysis." }, { status: 500 });
  }
}
