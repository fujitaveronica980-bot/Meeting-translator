"use client";

import { useState } from "react";
import type { Session, SessionMode } from "@/lib/types";
import { ReportView } from "@/components/ReportView";

const MODES: { value: SessionMode; label: string }[] = [
  { value: "meeting", label: "Meeting" },
  { value: "seminar", label: "Seminar" },
  { value: "casual", label: "Casual" },
];

export default function Home() {
  const [mode, setMode] = useState<SessionMode>("meeting");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  async function submit(useSample: boolean) {
    setLoading(true);
    setError(null);
    setSession(null);
    try {
      const form = new FormData();
      form.append("mode", mode);
      if (!useSample && file) form.append("audio", file);

      const res = await fetch("/api/sessions", { method: "POST", body: form });
      const data: Session = await res.json();

      if (!res.ok || data.status === "error") {
        setError(data.errorMessage || "Something went wrong.");
      }
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Meeting Translator
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a Japanese meeting recording to get a bilingual (JA/EN) transcript, summary,
            action items, glossary, and cultural notes.
          </p>
        </header>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Mode</label>
            <div className="flex gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
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

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Audio file
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-white hover:file:bg-zinc-700 dark:text-zinc-400 dark:file:bg-zinc-50 dark:file:text-zinc-900"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              disabled={loading || !file}
              onClick={() => submit(false)}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {loading ? "Processing…" : "Transcribe & Analyze"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => submit(true)}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Try sample recording
            </button>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            No audio? &ldquo;Try sample recording&rdquo; runs the full pipeline on a built-in demo
            dialogue — no upload, no API keys, no cost.
          </p>
        </form>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {session?.report && <ReportView report={session.report} />}
      </main>
    </div>
  );
}
