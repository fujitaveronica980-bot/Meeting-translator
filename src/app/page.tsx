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

export default function Home() {
  const [mode, setMode] = useState<SessionMode>("meeting");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const runPipeline = useCallback(
    async (opts: { file?: File | null; useSample?: boolean }) => {
      setLoading(true);
      setError(null);
      setSession(null);
      try {
        const form = new FormData();
        form.append("mode", mode);
        if (!opts.useSample && opts.file) form.append("audio", opts.file);

        const res = await fetch("/api/sessions", { method: "POST", body: form });
        const data: Session = await res.json();

        if (!res.ok || data.status === "error") {
          setError(data.errorMessage || "Something went wrong.");
        }
        setSession(data);
      } catch (err) {
        console.error("Failed to process session:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [mode]
  );

  // The loading/error/report state can land well below the fold, especially
  // right after a hands-off "record → auto-submit" flow where you're not
  // already scrolled down. Pull it into view as soon as there's something to
  // show, rather than leaving it easy to miss.
  useEffect(() => {
    if ((loading || session?.report || error) && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, session, error]);

  // Recording auto-submits on stop: turn it on at the start of the seminar,
  // turn it off at the end, and processing kicks off immediately — no
  // separate "now click submit" step.
  const recorder = useAudioRecorder((recordedFile) => {
    setFile(recordedFile);
    runPipeline({ file: recordedFile });
  });

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
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
                  disabled={loading}
                  className="flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
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
              Uses your microphone. Recording happens entirely in this tab — hit stop when the
              meeting ends and it starts transcribing &amp; analyzing right away.
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
              disabled={loading || !file || recorder.status === "recording"}
              onClick={() => runPipeline({ file })}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {loading ? "Processing…" : "Transcribe & Analyze"}
            </button>
            <button
              type="button"
              disabled={loading || recorder.status === "recording"}
              onClick={() => runPipeline({ useSample: true })}
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
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
              Transcribing &amp; analyzing — this can take a while for real recordings…
            </div>
          )}

          {session?.report && <ReportView report={session.report} />}
        </div>
      </main>
    </div>
  );
}
