import { NextResponse } from "next/server";
import { deleteSession, getSession } from "@/lib/session-store";

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
    return NextResponse.json(session);
  } catch (err) {
    console.error(`Failed to get session ${id}:`, err);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
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
