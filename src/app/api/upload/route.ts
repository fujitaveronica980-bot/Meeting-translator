import { createWriteStream, openAsBlob } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, expectedAuthCookieValue } from "@/lib/auth";
import { keepAwakeWhile } from "@/lib/keep-awake";
import { createSession, processSession } from "@/lib/pipeline";
import type { SessionMode } from "@/lib/types";

/**
 * Receives a recording and starts processing it.
 *
 * The audio is the raw request body (not multipart form data) and is
 * streamed straight to a temp file, so the server never holds a recording
 * in memory — an hour of audio is tens of MB, and buffering it (several
 * times over, between the proxy's body clone and form parsing) was enough
 * to push a small instance past its memory limit and get it restarted
 * mid-job. From disk it is streamed on to the STT provider the same way.
 *
 * That is also why this route sits outside the proxy matcher (see
 * proxy.ts): the proxy buffers the whole body of any request it handles.
 * The password gate is therefore checked here instead.
 */

const VALID_MODES: SessionMode[] = ["seminar", "meeting", "casual"];
// Far above any realistic recording (an hour of compressed audio is ~50MB);
// just stops a runaway upload from filling the disk.
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

class UploadTooLargeError extends Error {}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ status: "error", errorMessage: message }, { status });
}

export async function POST(req: NextRequest) {
  const expected = await expectedAuthCookieValue();
  if (expected && req.cookies.get(AUTH_COOKIE_NAME)?.value !== expected) {
    return errorResponse("You're signed out — reload the page and enter the password again.", 401);
  }

  const query = req.nextUrl.searchParams;
  const mode = query.get("mode");
  const resolvedMode: SessionMode = VALID_MODES.includes(mode as SessionMode)
    ? (mode as SessionMode)
    : "meeting";
  // Explicit flag rather than inferring "sample" from "no audio attached" —
  // a real STT provider correctly rejects empty audio instead of silently
  // ignoring it the way mock does.
  const useSample = query.get("sample") === "true";
  const filename = query.get("filename") || undefined;
  const mimeType = req.headers.get("content-type") || undefined;
  // Who the reader is, in their own words — sent as a header (URI-encoded,
  // since it's usually Japanese) rather than in the URL.
  let reader = "";
  try {
    reader = decodeURIComponent(req.headers.get("x-reader") ?? "").slice(0, 200);
  } catch {
    // malformed encoding: carry on without it
  }

  let tempPath: string | null = null;
  const discardUpload = () => {
    if (tempPath) unlink(tempPath).catch(() => {});
    tempPath = null;
  };

  try {
    if (!useSample) {
      if (!req.body) return errorResponse("No audio was uploaded.", 400);

      tempPath = join(tmpdir(), `meeting-translator-${randomUUID()}`);
      let received = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          callback(received > MAX_UPLOAD_BYTES ? new UploadTooLargeError() : null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(req.body as unknown as NodeReadableStream<Uint8Array>),
        limit,
        createWriteStream(tempPath)
      );
      if (received === 0) {
        discardUpload();
        return errorResponse("No audio was uploaded.", 400);
      }
    }

    const session = await createSession({ mode: resolvedMode, filename });
    const audioPath = tempPath;

    // Respond as soon as the upload is in, and do the slow part afterwards:
    // holding the request open for the whole transcription made long
    // recordings fail with an empty response once the host gave up on it.
    // The client polls GET /api/sessions/[id] for the result — but may not
    // be around to (screen off, page closed), hence keepAwakeWhile.
    after(() =>
      keepAwakeWhile(async () => {
        try {
          // A Blob backed by the file on disk: read as it's sent, never
          // loaded whole.
          const audio = audioPath ? await openAsBlob(audioPath, { type: mimeType }) : new Blob([]);
          await processSession(session, { audio, filename, mimeType, reader, useSample });
        } finally {
          if (audioPath) await unlink(audioPath).catch(() => {});
        }
      })
    );

    return NextResponse.json(session, { status: 202 });
  } catch (err) {
    discardUpload();
    if (err instanceof UploadTooLargeError) {
      return errorResponse("That recording is too large to upload (the limit is 1 GB).", 413);
    }
    // processSession() catches its own STT/LLM/persistence errors and
    // records them on the session — this is the last-resort net for
    // anything before that (e.g. an upload that broke off), so the client
    // always gets a real JSON body back instead of a broken response it
    // can't even parse.
    console.error("Unhandled error in POST /api/upload:", err);
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
}
