"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SessionMode } from "@/lib/types";
import { buildMemory } from "@/lib/memory";
import { MemoryView } from "@/components/MemoryView";
import { ReportView } from "@/components/ReportView";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";

const MODES: { value: SessionMode; label: string }[] = [
  { value: "meeting", label: "Meeting" },
  { value: "seminar", label: "Seminar" },
  { value: "casual", label: "Casual" },
];

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * One attempt (a recording, an uploaded file, or the sample). Kept in a
 * client-side list rather than a single "current result" slot so a
 * recording is never just gone: the raw audio and its outcome stay visible
 * and replayable in the sidebar even if analysis fails or you start
 * another recording before the first one finishes.
 */
interface RecordingEntry {
  id: string;
  createdAt: number;
  mode: SessionMode;
  kind: "recording" | "upload" | "sample";
  label: string;
  file: File | null;
  audioUrl: string | null;
  status: "processing" | "ready" | "error";
  session: Session | null;
  errorMessage: string | null;
  /** Status checks are currently failing — still processing, just out of reach. */
  unreachable?: boolean;
}

// How often to ask the server whether a recording has finished processing:
// quick at first so a short clip comes back promptly, then eased off, since
// an hour-long recording can take a good while to transcribe.
const POLL_INTERVAL_MS = 5000;
const SLOW_POLL_INTERVAL_MS = 20000;
const SLOW_POLL_AFTER_MS = 60 * 1000;
// While status checks are failing, back right off: the server may be busy
// or restarting, and the host's edge can start challenging a client that
// keeps hammering it.
const TROUBLE_POLL_INTERVAL_MS = 45000;
// Give up on a recording still "processing" this long after it was created:
// STT is capped at 3 hours server-side (see stt/poll.ts), so past this the
// server almost certainly restarted mid-run and will never finish it.
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;
// Consecutive failed status checks before telling the user about it. Not a
// reason to give up: the recording is still being processed server-side
// whether or not this page can currently reach it.
const POLL_FAILURES_BEFORE_NOTICE = 3;

/** Waits `ms`, or less if the page comes back into view (screen unlocked, tab reopened). */
function waitOrUntilVisible(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") done();
    };
    const timer = setTimeout(done, ms);
    document.addEventListener("visibilitychange", onVisible);
  });
}

/**
 * res.json() on an empty or non-JSON body (a gateway timeout, a host error
 * page) throws a bare parser error that says nothing useful — surface the
 * HTTP status instead.
 */
async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `The server returned ${text ? "an unexpected" : "an empty"} response (HTTP ${res.status}). Please try again.`
    );
  }
}

// selectedId value for the "Across meetings" view, which isn't a recording.
const MEMORY_VIEW = "memory";
const READER_STORAGE_KEY = "meeting-translator:reader";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [mode, setMode] = useState<SessionMode>("meeting");
  const [file, setFile] = useState<File | null>(null);
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Who the user is in their meetings, in their own words — lets the report
  // pick out what was asked of them. Remembered on this device.
  const [reader, setReader] = useState("");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved value after hydration
      setReader(localStorage.getItem(READER_STORAGE_KEY) ?? "");
    } catch {
      // storage unavailable (private window): the field just starts empty
    }
  }, []);
  const changeReader = useCallback((value: string) => {
    setReader(value);
    try {
      localStorage.setItem(READER_STORAGE_KEY, value);
    } catch {
      // not remembered, still used for this upload
    }
  }, []);
  const resultRef = useRef<HTMLDivElement | null>(null);
  // Entry id -> the server session currently being polled for it. A poll
  // loop stops as soon as its entry is retried, deleted, or the page unmounts.
  const activePolls = useRef(new Map<string, string>());

  // Object URLs are only released when the tab closes/unmounts, so a
  // recording stays replayable for as long as the page is open.
  useEffect(() => {
    const polls = activePolls.current;
    return () => {
      recordings.forEach((r) => r.audioUrl && URL.revokeObjectURL(r.audioUrl));
      polls.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateEntry = useCallback((id: string, patch: Partial<RecordingEntry>) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  // Processing happens server-side after the upload request has already
  // returned, so the outcome is fetched by polling the session.
  const pollSession = useCallback(
    async (entryId: string, session: Session) => {
      if (activePolls.current.get(entryId) === session.id) return; // already polling
      activePolls.current.set(entryId, session.id);
      const startedAt = new Date(session.createdAt).getTime();
      let failures = 0;

      while (activePolls.current.get(entryId) === session.id) {
        const interval =
          failures >= POLL_FAILURES_BEFORE_NOTICE
            ? TROUBLE_POLL_INTERVAL_MS
            : Date.now() - startedAt > SLOW_POLL_AFTER_MS
              ? SLOW_POLL_INTERVAL_MS
              : POLL_INTERVAL_MS;
        await waitOrUntilVisible(interval);
        if (activePolls.current.get(entryId) !== session.id) return;

        let latest: Session | null = null;
        let fatal: string | null = null;
        try {
          const res = await fetch(`/api/sessions/${session.id}`);
          if (res.status === 404) {
            fatal = "The server no longer has this recording — it may have restarted. Please try again.";
          } else if (res.ok) {
            latest = await readJson<Session>(res);
          }
        } catch (err) {
          console.error("Failed to check recording status:", err);
        }
        if (activePolls.current.get(entryId) !== session.id) return;

        if (latest?.status === "ready") {
          updateEntry(entryId, {
            status: "ready",
            session: latest,
            errorMessage: null,
            unreachable: false,
          });
        } else if (latest?.status === "error") {
          updateEntry(entryId, {
            status: "error",
            errorMessage: latest.errorMessage || "Something went wrong.",
            session: latest,
            unreachable: false,
          });
        } else {
          failures = latest ? 0 : failures + 1;
          // Measured from the last sign of life, not just creation: an old
          // recording being re-analyzed is not stale for being old.
          const lastAlive = Math.max(
            startedAt,
            latest?.heartbeatAt ? new Date(latest.heartbeatAt).getTime() : 0
          );
          if (!fatal && Date.now() - lastAlive > STALE_AFTER_MS) {
            fatal = "Processing was interrupted before it finished. Please try again.";
          }
          if (!fatal) {
            // A failed check says nothing about the recording itself, so
            // keep waiting — just say so, and check less often.
            updateEntry(entryId, {
              ...(latest ? { session: latest } : {}),
              unreachable: failures >= POLL_FAILURES_BEFORE_NOTICE,
            });
            continue;
          }
          updateEntry(entryId, { status: "error", errorMessage: fatal, unreachable: false });
        }
        activePolls.current.delete(entryId);
        return;
      }
    },
    [updateEntry]
  );

  // Restore past sessions on load, when persistence is configured server-
  // side — otherwise this just returns an empty list and the sidebar starts
  // fresh like before. Audio isn't persisted, so restored entries have no
  // player/retry (no file to retry with) — just the report itself.
  useEffect(() => {
    fetch("/api/sessions")
      .then((res) => readJson<{ sessions: Session[] }>(res))
      .then((data) => {
        setRecordings((prev) => [
          ...prev,
          // Skip anything already listed — dev-mode React runs this effect
          // twice, which otherwise lists every restored session twice.
          ...data.sessions
            .filter((s) => !prev.some((r) => r.id === s.id || r.session?.id === s.id))
            .map(
            (s): RecordingEntry => ({
              id: s.id,
              createdAt: new Date(s.createdAt).getTime(),
              mode: s.mode,
              kind: "upload",
              label: s.title || s.audioFile || "Recording",
              file: null,
              audioUrl: null,
              status: s.status === "ready" ? "ready" : s.status === "error" ? "error" : "processing",
              session: s,
              errorMessage: s.errorMessage ?? null,
            })
          ),
        ]);
        // Still being processed server-side (e.g. the page was reloaded
        // mid-run) — pick the polling back up rather than showing
        // "Processing…" forever.
        data.sessions
          .filter((s) => s.status !== "ready" && s.status !== "error")
          .forEach((s) => pollSession(s.id, s));
      })
      .catch((err) => console.error("Failed to load session history:", err));
  }, [pollSession]);

  const submit = useCallback(
    async (
      entryId: string,
      entryMode: SessionMode,
      entryFile: File | null,
      useSample: boolean,
      entryReader: string
    ) => {
      activePolls.current.delete(entryId);
      updateEntry(entryId, {
        status: "processing",
        errorMessage: null,
        session: null,
        unreachable: false,
      });
      try {
        // The audio goes up as the raw request body (not form data) so the
        // server can stream it to disk instead of holding it in memory.
        const query = new URLSearchParams({ mode: entryMode });
        if (useSample) query.set("sample", "true");
        else if (entryFile) query.set("filename", entryFile.name);
        const upload = !useSample && entryFile ? entryFile : null;

        const res = await fetch(`/api/upload?${query}`, {
          method: "POST",
          body: upload,
          headers: {
            ...(upload ? { "Content-Type": upload.type || "application/octet-stream" } : {}),
            // URI-encoded: header values can't carry Japanese as-is.
            ...(entryReader.trim() ? { "X-Reader": encodeURIComponent(entryReader.trim()) } : {}),
          },
        });
        const data = await readJson<Session>(res);

        if (!res.ok || data.status === "error") {
          updateEntry(entryId, {
            status: "error",
            errorMessage: data.errorMessage || "Something went wrong.",
          });
        } else {
          // Upload accepted — the server carries on processing in the
          // background, so wait for the result by polling.
          updateEntry(entryId, { session: data });
          pollSession(entryId, data);
        }
      } catch (err) {
        console.error("Failed to process recording:", err);
        updateEntry(entryId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [updateEntry, pollSession]
  );

  const startEntry = useCallback(
    (opts: { kind: RecordingEntry["kind"]; file: File | null; label: string }) => {
      const id = newId();
      const entry: RecordingEntry = {
        id,
        createdAt: Date.now(),
        mode,
        kind: opts.kind,
        label: opts.label,
        file: opts.file,
        audioUrl: opts.file ? URL.createObjectURL(opts.file) : null,
        status: "processing",
        session: null,
        errorMessage: null,
      };
      setRecordings((prev) => [entry, ...prev]);
      setSelectedId(id);
      submit(id, mode, opts.file, opts.kind === "sample", reader);
    },
    [mode, reader, submit]
  );

  const retry = useCallback(
    (entryId: string) => {
      const entry = recordings.find((r) => r.id === entryId);
      if (!entry) return;
      setSelectedId(entryId);
      submit(entryId, entry.mode, entry.file, entry.kind === "sample", reader);
    },
    [recordings, reader, submit]
  );

  // Rebuilds the report from the transcript the server kept — no upload, no
  // transcription cost. Picks up the current "Who are you" value.
  const reanalyze = useCallback(
    async (entryId: string) => {
      const entry = recordings.find((r) => r.id === entryId);
      if (!entry?.session) return;
      activePolls.current.delete(entryId);
      updateEntry(entryId, { status: "processing", errorMessage: null, unreachable: false });
      try {
        const res = await fetch(`/api/sessions/${entry.session.id}/reanalyze`, {
          method: "POST",
          headers: reader.trim() ? { "X-Reader": encodeURIComponent(reader.trim()) } : undefined,
        });
        const data = await readJson<Session & { error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Could not start the re-analysis.");
        updateEntry(entryId, { session: data });
        pollSession(entryId, data);
      } catch (err) {
        console.error("Failed to re-analyze recording:", err);
        updateEntry(entryId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [recordings, reader, updateEntry, pollSession]
  );

  const deleteEntry = useCallback(
    (entryId: string) => {
      const entry = recordings.find((r) => r.id === entryId);
      activePolls.current.delete(entryId);
      if (entry?.audioUrl) URL.revokeObjectURL(entry.audioUrl);
      setRecordings((prev) => prev.filter((r) => r.id !== entryId));
      setSelectedId((prev) => (prev === entryId ? null : prev));
      // Sessions persist server-side now (when configured) — delete there too,
      // or it'd just reappear next time history is loaded. A fresh entry's id
      // is client-generated, so go by its server session's id when it has one.
      fetch(`/api/sessions/${entry?.session?.id ?? entryId}`, { method: "DELETE" }).catch((err) =>
        console.error("Failed to delete session:", err)
      );
    },
    [recordings]
  );

  // Recording auto-submits on stop: turn it on at the start of the seminar,
  // turn it off at the end, and processing kicks off immediately — no
  // separate "now click submit" step. The raw audio lands in the sidebar
  // either way, so a failed analysis never loses the recording itself.
  const recorder = useAudioRecorder((recordedFile) => {
    startEntry({
      kind: "recording",
      file: recordedFile,
      label: `Recording · ${new Date().toLocaleTimeString()}`,
    });
  });

  // An entry has no server session until its upload has gone through. The
  // screen has to stay on for recording and uploading — the browser stops
  // both when it locks — but not after that: processing is server-side.
  const uploading = recordings.some((r) => r.status === "processing" && !r.session);
  useScreenWakeLock(recorder.status === "recording" || uploading);

  const selected = recordings.find((r) => r.id === selectedId) ?? null;

  const memory = useMemo(
    () => buildMemory(recordings.flatMap((r) => (r.session ? [r.session] : []))),
    [recordings]
  );
  const openActionCount = memory.actions.filter((a) => !a.done).length;

  const toggleAction = useCallback(
    (sessionId: string, index: number, done: boolean) => {
      const entry = recordings.find((r) => r.session?.id === sessionId);
      if (!entry?.session) return;
      const current = new Set(entry.session.doneActions ?? []);
      if (done) current.add(index);
      else current.delete(index);
      const doneActions = [...current].sort((a, b) => a - b);
      updateEntry(entry.id, { session: { ...entry.session, doneActions } });
      fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doneActions }),
      }).catch((err) => console.error("Failed to save action item state:", err));
    },
    [recordings, updateEntry]
  );

  // Real-usage-based estimate (see gemini.ts), summed across whatever's
  // currently loaded in the sidebar — not exact billing, but grounded in
  // actual token counts rather than guessed. STT cost isn't included.
  const totalCostUsd = recordings.reduce((sum, r) => sum + (r.session?.estimatedCostUsd ?? 0), 0);
  // Approximate — set for a rough JPY conversion, not a live exchange rate.
  const USD_TO_JPY = 150;
  const budgetJpy = process.env.NEXT_PUBLIC_GEMINI_BUDGET_JPY
    ? Number(process.env.NEXT_PUBLIC_GEMINI_BUDGET_JPY)
    : null;
  const costJpy = totalCostUsd * USD_TO_JPY;
  const budgetPct = budgetJpy ? Math.min(100, (costJpy / budgetJpy) * 100) : null;

  // Pull the result panel into view whenever the selected entry changes —
  // covers both "just submitted something" and "clicked an older entry".
  const showingMemory = selectedId === MEMORY_VIEW;
  useEffect(() => {
    if ((selected || showingMemory) && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selected, showingMemory]);

  return (
    <div className="flex flex-1 flex-col bg-background font-sans">
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-8 px-6 py-12 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-8">
          <header className="hero-gradient flex flex-col gap-1 rounded-2xl px-6 py-8 text-white shadow-sm sm:px-8 sm:py-10">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-xl font-semibold">Meeting Translator</h1>
              <a href="/api/logout" className="shrink-0 text-xs text-white/70 hover:text-white hover:underline">
                Log out
              </a>
            </div>
            <p className="text-sm text-white/85">
              Record live or upload a Japanese meeting recording to get a bilingual (JA/EN)
              summary, key topics, action items, glossary, and cultural notes.
            </p>
          </header>

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Mode</label>
              <div className="flex gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    disabled={recorder.status === "recording"}
                    className={`min-h-10 rounded-full px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      mode === m.value
                        ? "bg-accent text-accent-foreground"
                        : "bg-subtle text-muted hover:bg-border"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4">
              <label htmlFor="reader" className="text-sm font-medium text-foreground">
                Who are you in this meeting? <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="reader"
                type="text"
                value={reader}
                onChange={(e) => changeReader(e.target.value)}
                maxLength={200}
                placeholder="e.g. 藤田 (Fujita), the new inside-sales contractor"
                className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60"
              />
              <p className="text-xs text-muted/80">
                With this, the report adds a &ldquo;For you&rdquo; section: what you were asked to do, what
                you promised, and a recap message written in your voice. Remembered on this device.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4">
              <label className="text-sm font-medium text-foreground">Record live</label>
              <div className="flex items-center gap-3">
                {recorder.status === "recording" ? (
                  <button
                    type="button"
                    onClick={recorder.stop}
                    className="flex min-h-11 items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                    Stop &amp; Process ({formatElapsed(recorder.elapsedSec)})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={recorder.start}
                    className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-subtle"
                  >
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    Start Recording
                  </button>
                )}
                {recorder.status === "recording" && (
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full bg-red-500 transition-[width] duration-100"
                      style={{ width: `${Math.round(recorder.level * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted/80">
                Uses your microphone. Hit stop when the meeting ends — it starts processing right
                away, and the recording stays in the list on the right no matter what happens next.
                The screen is kept on while recording: a browser stops recording if it locks.
              </p>
              {recorder.status === "error" && (
                <p className="text-xs text-red-600 dark:text-red-400">{recorder.error}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4">
              <label className="text-sm font-medium text-foreground">Or upload a file</label>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={recorder.status === "recording"}
                className="text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-accent-foreground hover:file:opacity-90 disabled:opacity-40"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={!file || recorder.status === "recording"}
                onClick={() => {
                  if (!file) return;
                  startEntry({ kind: "upload", file, label: file.name });
                  setFile(null);
                }}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Transcribe &amp; Analyze
              </button>
              <button
                type="button"
                disabled={recorder.status === "recording"}
                onClick={() =>
                  startEntry({ kind: "sample", file: null, label: "Sample recording" })
                }
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
              >
                Try sample recording
              </button>
            </div>
            <p className="text-xs text-muted/80">
              No audio? &ldquo;Try sample recording&rdquo; runs the full pipeline on a built-in demo
              dialogue — no upload, no API keys, no cost.
            </p>
          </div>

          <div ref={resultRef} className="flex flex-col gap-8 scroll-mt-6">
            {showingMemory && <MemoryView memory={memory} onToggleAction={toggleAction} />}

            {selected?.audioUrl && (
              <audio controls src={selected.audioUrl} className="w-full">
                Your browser doesn&apos;t support inline audio playback.
              </audio>
            )}

            {selected?.status === "error" && (
              <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                <span>{selected.errorMessage}</span>
                {/* No file to retry with for a restored session — audio isn't persisted. */}
                {(selected.file || selected.kind === "sample") && (
                  <button
                    type="button"
                    onClick={() => retry(selected.id)}
                    className="self-start rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {selected?.status === "processing" && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-muted" />
                {!selected.session
                  ? "Uploading — keep this page open and the screen on until the upload finishes."
                  : selected.unreachable
                    ? "Can't reach the server right now — still trying. Your recording is still being processed, so there's no need to upload it again."
                    : selected.session.status === "analyzing"
                    ? "Transcribed — now analyzing…"
                    : "Transcribing — an hour-long recording can take 10 minutes or more. It carries on if your screen turns off; the report will be here when you come back."}
              </div>
            )}

            {selected?.session?.report && selected.status !== "processing" && (
              <ReportView
                report={selected.session.report}
                onReanalyze={selected.session.hasTranscript ? () => reanalyze(selected.id) : undefined}
              />
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-12 lg:self-start">
          <button
            type="button"
            onClick={() => setSelectedId(MEMORY_VIEW)}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
              showingMemory ? "border-accent bg-surface" : "border-border bg-surface hover:bg-subtle"
            }`}
          >
            <span className="font-medium text-foreground">Across meetings</span>
            <span className="text-xs text-muted">
              {openActionCount} open {openActionCount === 1 ? "action" : "actions"}
            </span>
          </button>

          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recordings</h2>

          {(totalCostUsd > 0 || budgetJpy) && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-muted">Estimated Gemini spend</span>
                <span className="font-medium text-foreground">${totalCostUsd.toFixed(4)}</span>
              </div>
              {budgetJpy && budgetPct !== null && (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${budgetPct}%` }}
                    />
                  </div>
                  <p className="text-muted">
                    ~¥{costJpy.toFixed(0)} of ¥{budgetJpy.toLocaleString()} ({budgetPct.toFixed(1)}%)
                  </p>
                </>
              )}
              <p className="text-muted/70">
                Estimate from real token usage — not exact billing, and doesn&apos;t include STT cost.
              </p>
            </div>
          )}

          {recordings.length === 0 ? (
            <p className="text-sm text-muted/80">
              Nothing yet — recordings, uploads, and the sample all show up here as you make them.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recordings.map((r) => (
                <li
                  key={r.id}
                  className={`group relative rounded-lg border text-sm transition-colors ${
                    r.id === selectedId
                      ? "border-accent bg-surface"
                      : "border-border bg-surface hover:bg-subtle"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className="flex w-full flex-col gap-1 p-3 pr-12 text-left"
                  >
                    <span className="truncate font-medium text-foreground">
                      {r.session?.report?.title.en || r.label}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {r.status === "processing" && (
                        <>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                          Processing…
                        </>
                      )}
                      {r.status === "ready" && (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Ready
                        </>
                      )}
                      {r.status === "error" && (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                          Failed
                        </>
                      )}
                      <span>· {new Date(r.createdAt).toLocaleTimeString()}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Delete this recording? This can't be undone.")) {
                        deleteEntry(r.id);
                      }
                    }}
                    aria-label="Delete recording"
                    title="Delete recording"
                    className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full text-muted opacity-60 transition-opacity hover:bg-red-100 hover:text-red-600 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.75 1a.75.75 0 0 0-.75.75V3H4.5a.75.75 0 0 0 0 1.5h.322l.8 10.4A2.25 2.25 0 0 0 7.865 17h4.27a2.25 2.25 0 0 0 2.243-2.1l.8-10.4h.322a.75.75 0 0 0 0-1.5H12v-1.25a.75.75 0 0 0-.75-.75h-2.5ZM10 6a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 10 6Zm-2.25.75a.75.75 0 0 0-1.5.058l.25 6.5a.75.75 0 1 0 1.5-.058l-.25-6.5Zm5-.692a.75.75 0 0 1 .692.808l-.25 6.5a.75.75 0 1 1-1.498-.058l.25-6.5a.75.75 0 0 1 .806-.75Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}
