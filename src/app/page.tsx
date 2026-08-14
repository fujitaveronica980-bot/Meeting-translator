"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SessionMode } from "@/lib/types";
import { ReportView } from "@/components/ReportView";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";

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
}

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
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Object URLs are only released when the tab closes/unmounts, so a
  // recording stays replayable for as long as the page is open.
  useEffect(() => {
    return () => {
      recordings.forEach((r) => r.audioUrl && URL.revokeObjectURL(r.audioUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateEntry = useCallback((id: string, patch: Partial<RecordingEntry>) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const submit = useCallback(
    async (entryId: string, entryMode: SessionMode, entryFile: File | null, useSample: boolean) => {
      updateEntry(entryId, { status: "processing", errorMessage: null });
      try {
        const form = new FormData();
        form.append("mode", entryMode);
        if (useSample) {
          form.append("sample", "true");
        } else if (entryFile) {
          form.append("audio", entryFile);
        }

        const res = await fetch("/api/sessions", { method: "POST", body: form });
        const data: Session = await res.json();

        if (!res.ok || data.status === "error") {
          updateEntry(entryId, {
            status: "error",
            errorMessage: data.errorMessage || "Something went wrong.",
            session: data,
          });
        } else {
          updateEntry(entryId, { status: "ready", session: data, errorMessage: null });
        }
      } catch (err) {
        console.error("Failed to process recording:", err);
        updateEntry(entryId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [updateEntry]
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
      submit(id, mode, opts.file, opts.kind === "sample");
    },
    [mode, submit]
  );

  const retry = useCallback(
    (entryId: string) => {
      const entry = recordings.find((r) => r.id === entryId);
      if (!entry) return;
      setSelectedId(entryId);
      submit(entryId, entry.mode, entry.file, entry.kind === "sample");
    },
    [recordings, submit]
  );

  const deleteEntry = useCallback((entryId: string) => {
    setRecordings((prev) => {
      const entry = prev.find((r) => r.id === entryId);
      if (entry?.audioUrl) URL.revokeObjectURL(entry.audioUrl);
      return prev.filter((r) => r.id !== entryId);
    });
    setSelectedId((prev) => (prev === entryId ? null : prev));
  }, []);

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

  const selected = recordings.find((r) => r.id === selectedId) ?? null;

  // Pull the result panel into view whenever the selected entry changes —
  // covers both "just submitted something" and "clicked an older entry".
  useEffect(() => {
    if (selected && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selected]);

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
              transcript, summary, action items, glossary, and cultural notes.
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
                    className={`rounded-full px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
              <label className="text-sm font-medium text-foreground">Record live</label>
              <div className="flex items-center gap-3">
                {recorder.status === "recording" ? (
                  <button
                    type="button"
                    onClick={recorder.stop}
                    className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                    Stop &amp; Process ({formatElapsed(recorder.elapsedSec)})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={recorder.start}
                    className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-subtle"
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
            {selected?.audioUrl && (
              <audio controls src={selected.audioUrl} className="w-full">
                Your browser doesn&apos;t support inline audio playback.
              </audio>
            )}

            {selected?.status === "error" && (
              <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                <span>{selected.errorMessage}</span>
                <button
                  type="button"
                  onClick={() => retry(selected.id)}
                  className="self-start rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
                >
                  Retry
                </button>
              </div>
            )}

            {selected?.status === "processing" && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-muted" />
                Transcribing &amp; analyzing — this can take a while for real recordings…
              </div>
            )}

            {selected?.session?.report && <ReportView report={selected.session.report} />}
          </div>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-12 lg:self-start">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recordings</h2>
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
                    className="flex w-full flex-col gap-1 p-3 pr-8 text-left"
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
                    className="absolute right-2 top-2 rounded-full p-1 text-muted opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
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
