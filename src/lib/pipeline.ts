import { v4 as uuidv4 } from "uuid";
import { getSttProvider } from "@/lib/stt";
import { mockProvider } from "@/lib/stt/mock";
import { getAnalysisProvider } from "@/lib/llm";
import { mockAnalysisProvider } from "@/lib/llm/mock";
import type { AnalysisInputLine } from "@/lib/llm";
import type { MeetingReport, Session, SessionMode, TranscriptLine } from "@/lib/types";
import { saveSession } from "@/lib/session-store";

/**
 * Registers a new session and saves it in its initial "transcribing" state,
 * so the client has an id to poll before any slow work has started.
 */
export async function createSession(params: {
  mode: SessionMode;
  filename?: string;
}): Promise<Session> {
  const session: Session = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    mode: params.mode,
    status: "transcribing",
    audioFile: params.filename,
  };
  await saveSession(session);
  return session;
}

/**
 * Runs a created session end to end: STT -> translate/analyze -> assemble
 * report, saving progress to the session store as it goes. Deliberately not
 * tied to the request that uploaded the audio — a real recording takes many
 * minutes (STT polls for up to 20), far longer than a host will hold one
 * HTTP request open, so api/sessions/route.ts runs this after responding
 * and the client polls the session until it's ready.
 */
export async function processSession(
  session: Session,
  params: {
    audio: Buffer;
    filename?: string;
    mimeType?: string;
    /**
     * The "Try sample recording" button: always forces the mock STT + mock
     * analysis providers, regardless of which real providers are configured.
     * There's no real audio behind the canned demo dialogue, so a real STT
     * provider has nothing valid to transcribe — and even if there were,
     * routing the fixed demo text through a real (paid) provider on every
     * click would defeat the point of a free, zero-signup sample.
     */
    useSample?: boolean;
  }
): Promise<Session> {
  try {
    const stt = params.useSample ? mockProvider : getSttProvider();
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
    await saveSession(session);

    const analysisInput: AnalysisInputLine[] = linesWithIds.map((l) => ({
      id: l.id,
      speaker: l.speaker,
      japanese: l.text,
    }));
    const participants = Array.from(new Set(linesWithIds.map((l) => l.speaker)));

    // Transcription already succeeded and already cost real money — a
    // translation/analysis failure past this point shouldn't throw that
    // away. Handled as its own inner try/catch (rather than falling into
    // the outer one below) so we can still assemble and save a report
    // containing the raw transcript, just untranslated, instead of nothing.
    try {
      const llm = params.useSample ? mockAnalysisProvider : getAnalysisProvider();
      const analysis = await llm.analyze(analysisInput, session.mode);

      const englishById = new Map(analysis.transcriptEnglish.map((t) => [t.id, t.english]));
      const transcript: TranscriptLine[] = linesWithIds.map((l) => ({
        id: l.id,
        speaker: l.speaker,
        startMs: l.startMs,
        endMs: l.endMs,
        japanese: l.text,
        english: englishById.get(l.id) ?? "",
      }));

      const report: MeetingReport = {
        title: analysis.title,
        mode: session.mode,
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
      session.estimatedCostUsd = analysis.estimatedCostUsd;
    } catch (analysisErr) {
      const message = analysisErr instanceof Error ? analysisErr.message : String(analysisErr);
      session.status = "error";
      session.errorMessage = `Transcription succeeded, but translation/analysis failed: ${message}`;
      session.report = {
        title: {
          ja: "文字起こしのみ（分析エラー）",
          en: "Transcript only (translation/analysis failed)",
        },
        mode: session.mode,
        durationMs: transcription.durationMs,
        recordedAt: session.createdAt,
        participants,
        executiveSummary: {
          ja: ["翻訳・分析に失敗しましたが、文字起こし自体は完了しています。下記をご確認ください。"],
          en: ["Translation/analysis failed, but the transcription itself succeeded — see below."],
        },
        keyTopics: [],
        actionItems: [],
        recommendations: [],
        glossary: [],
        culturalNotes: [],
        transcript: linesWithIds.map((l) => ({
          id: l.id,
          speaker: l.speaker,
          startMs: l.startMs,
          endMs: l.endMs,
          japanese: l.text,
          english: "[translation unavailable]",
        })),
      };
    }

    await saveSession(session);
  } catch (err) {
    session.status = "error";
    session.errorMessage = err instanceof Error ? err.message : String(err);
    // Nothing is awaiting this any more (it runs after the response), so a
    // failed save here must not escape as an unhandled rejection.
    await saveSession(session).catch((saveErr) =>
      console.error(`Failed to save error state for session ${session.id}:`, saveErr)
    );
  }

  return session;
}
