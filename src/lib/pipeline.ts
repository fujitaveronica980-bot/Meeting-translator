import { v4 as uuidv4 } from "uuid";
import { getSttProvider } from "@/lib/stt";
import { getAnalysisProvider } from "@/lib/llm";
import type { AnalysisInputLine } from "@/lib/llm";
import type { MeetingReport, Session, SessionMode, TranscriptLine } from "@/lib/types";
import { saveSession } from "@/lib/session-store";

/**
 * Runs a session end to end: STT -> translate/analyze -> assemble report.
 * Synchronous within the request for simplicity; the mock provider is
 * instant, and real STT providers already poll internally. A queue/webhook
 * based flow would be the natural upgrade if this ever needs to survive
 * request timeouts on a given host.
 */
export async function runSession(params: {
  audio: Buffer;
  mode: SessionMode;
  filename?: string;
  mimeType?: string;
}): Promise<Session> {
  const session: Session = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    mode: params.mode,
    status: "transcribing",
    audioFile: params.filename,
  };
  saveSession(session);

  try {
    const stt = getSttProvider();
    const transcription = await stt.transcribe(params.audio, {
      language: "ja",
      filename: params.filename,
      mimeType: params.mimeType,
    });

    const linesWithIds = transcription.segments.map((seg) => ({
      id: uuidv4(),
      ...seg,
    }));

    session.status = "analyzing";
    session.audioDurationSec = Math.round(transcription.durationMs / 1000);
    saveSession(session);

    const analysisInput: AnalysisInputLine[] = linesWithIds.map((l) => ({
      id: l.id,
      speaker: l.speaker,
      japanese: l.text,
    }));

    const llm = getAnalysisProvider();
    const analysis = await llm.analyze(analysisInput, params.mode);

    const englishById = new Map(analysis.transcriptEnglish.map((t) => [t.id, t.english]));
    const transcript: TranscriptLine[] = linesWithIds.map((l) => ({
      id: l.id,
      speaker: l.speaker,
      startMs: l.startMs,
      endMs: l.endMs,
      japanese: l.text,
      english: englishById.get(l.id) ?? "",
    }));

    const participants = Array.from(new Set(transcript.map((l) => l.speaker)));

    const report: MeetingReport = {
      title: analysis.title,
      mode: params.mode,
      durationMs: transcription.durationMs,
      recordedAt: session.createdAt,
      participants,
      executiveSummary: analysis.executiveSummary,
      keyTopics: analysis.keyTopics,
      actionItems: analysis.actionItems,
      recommendations: analysis.recommendations,
      glossary: analysis.glossary,
      culturalNotes: analysis.culturalNotes,
      transcript,
      suggestedReplies: analysis.suggestedReplies,
    };

    session.status = "ready";
    session.title = report.title.en;
    session.report = report;
    saveSession(session);
  } catch (err) {
    session.status = "error";
    session.errorMessage = err instanceof Error ? err.message : String(err);
    saveSession(session);
  }

  return session;
}
