import { NextResponse } from "next/server";
import { deleteSession, getSession, saveSession, setDoneActions } from "@/lib/session-store";

// The pipeline refreshes a session's heartbeat every 30 seconds while it is
// working on it, so several minutes of silence means the server process that
// was running it is gone (redeployed, crashed, put to sleep).
const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const inProgress = session.status !== "ready" && session.status !== "error";
    if (
      inProgress &&
      session.heartbeatAt &&
      Date.now() - new Date(session.heartbeatAt).getTime() > HEARTBEAT_STALE_MS
    ) {
      session.status = "error";
      session.errorMessage =
        "Processing was interrupted — the server restarted before it finished. Please upload the recording again.";
      await saveSession(session);
    }
    return NextResponse.json(session);
  } catch (err) {
    console.error(`Failed to get session ${id}:`, err);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
}

/** Ticks action items on or off: body is { doneActions: number[] }, the full new set. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => null);
    const doneActions: unknown = body?.doneActions;
    if (
      !Array.isArray(doneActions) ||
      !doneActions.every((n) => Number.isInteger(n) && n >= 0 && n < 1000)
    ) {
      return NextResponse.json({ error: "doneActions must be a list of item indexes" }, { status: 400 });
    }
    await setDoneActions(id, [...new Set(doneActions as number[])].sort((a, b) => a - b));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Failed to update session ${id}:`, err);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Failed to delete session ${id}:`, err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
