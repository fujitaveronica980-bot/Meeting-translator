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
        if (!useSample && entryFile) form.append("audio", entryFile);

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
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-8 px-6 py-12 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Meeting Translator
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Record live or upload a Japanese meeting recording to get a bilingual (JA/EN)
              transcript, summary, action items, glossary, and cultural notes.
            </p>
          </header>

          <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Mode</label>
              <div className="flex gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    disabled={recorder.status === "recording"}
                    className={`rounded-full px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      mode === m.value
                        ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-4 dark:border-zinc-900">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Record live
              </label>
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
                    className="flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    Start Recording
                  </button>
                )}
                {recorder.status === "recording" && (
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                    <div
                      className="h-full rounded-full bg-red-500 transition-[width] duration-100"
                      style={{ width: `${Math.round(recorder.level * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Uses your microphone. Hit stop when the meeting ends — it starts processing right
                away, and the recording stays in the list on the right no matter what happens next.
              </p>
              {recorder.status === "error" && (
                <p className="text-xs text-red-600 dark:text-red-400">{recorder.error}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-4 dark:border-zinc-900">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Or upload a file
              </label>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={recorder.status === "recording"}
                className="text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-white hover:file:bg-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:file:bg-zinc-50 dark:file:text-zinc-900"
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
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Transcribe &amp; Analyze
              </button>
              <button
                type="button"
                disabled={recorder.status === "recording"}
                onClick={() =>
                  startEntry({ kind: "sample", file: null, label: "Sample recording" })
                }
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Try sample recording
              </button>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
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
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
                Transcribing &amp; analyzing — this can take a while for real recordings…
              </div>
            )}

            {selected?.session?.report && <ReportView report={selected.session.report} />}
          </div>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-12 lg:self-start">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Recordings
          </h2>
          {recordings.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Nothing yet — recordings, uploads, and the sample all show up here as you make them.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recordings.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-colors ${
                      r.id === selectedId
                        ? "border-zinc-900 bg-white dark:border-zinc-50 dark:bg-zinc-950"
                        : "border-zinc-200 bg-white hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {r.session?.report?.title.en || r.label}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {r.status === "processing" && (
                        <>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
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
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}
