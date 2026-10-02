import { v4 as uuidv4 } from "uuid";
import { getSttProvider } from "@/lib/stt";
import { mockProvider } from "@/lib/stt/mock";
import { getAnalysisProvider } from "@/lib/llm";
import { mockAnalysisProvider } from "@/lib/llm/mock";
import type { AnalysisContext, AnalysisInputLine } from "@/lib/llm";
import { memoryContext } from "@/lib/memory";
import type { MeetingReport, Session, SessionMode, TranscriptLine } from "@/lib/types";
import {
  getTranscript,
  listSessions,
  saveSession,
  saveTranscript,
  touchSession,
  type StoredTranscript,
} from "@/lib/session-store";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

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
    heartbeatAt: new Date().toISOString(),
  };
  await saveSession(session);
  return session;
}

/**
 * Proof of life for whoever is polling: while `work` runs, the session's
 * heartbeat is refreshed, so if this process dies mid-run the session can
 * be reported as interrupted instead of sitting at "transcribing" forever.
 */
async function withHeartbeat(session: Session, work: () => Promise<void>): Promise<void> {
  const heartbeat = setInterval(() => {
    session.heartbeatAt = new Date().toISOString();
    touchSession(session.id, session.heartbeatAt).catch((err) =>
      console.error(`Failed to save heartbeat for session ${session.id}:`, err)
    );
  }, HEARTBEAT_INTERVAL_MS);
  try {
    await work();
  } catch (err) {
    session.status = "error";
    session.errorMessage = err instanceof Error ? err.message : String(err);
    // Nothing is awaiting this any more (it runs after the response), so a
    // failed save here must not escape as an unhandled rejection.
    await saveSession(session).catch((saveErr) =>
      console.error(`Failed to save error state for session ${session.id}:`, saveErr)
    );
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Turns a transcript into the session's report. Sets the session's fields
 * but leaves saving to the caller.
 *
 * Transcription already succeeded and already cost real money — an analysis
 * failure shouldn't throw that away, so it is caught here and the session
 * gets a report carrying the raw transcript (the only case a report
 * includes it) instead of nothing.
 */
async function analyzeTranscript(
  session: Session,
  transcript: StoredTranscript,
  reader: string
): Promise<void> {
  const { segments, durationMs } = transcript;
  const analysisInput: AnalysisInputLine[] = segments.map((seg) => ({
    speaker: seg.speaker,
    startMs: seg.startMs,
    japanese: seg.text,
  }));
  const participants = Array.from(new Set(segments.map((seg) => seg.speaker)));

  try {
    // The sample always stays on the mock provider: routing the fixed demo
    // text through a real (paid) provider would defeat the point of a
    // free, zero-signup sample.
    const llm = transcript.sample ? mockAnalysisProvider : getAnalysisProvider();
    // What earlier recordings established. Worth having, not worth
    // failing over: a broken history lookup just means no context.
    const earlier = await listSessions().catch((err) => {
      console.error("Could not load earlier sessions for context:", err);
      return [];
    });
    const context: AnalysisContext = {
      reader,
      memory: memoryContext(earlier.filter((s) => s.id !== session.id)),
    };
    const analysis = await llm.analyze(analysisInput, session.mode, context);

    const report: MeetingReport = {
      title: analysis.title,
      mode: session.mode,
      durationMs,
      recordedAt: session.createdAt,
      participants,
      // Spread rather than assigned: Firestore rejects undefined fields.
      ...(analysis.overview ? { overview: analysis.overview } : {}),
      ...(analysis.keyPoints ? { keyPoints: analysis.keyPoints } : {}),
      executiveSummary: analysis.executiveSummary,
      keyTopics: analysis.keyTopics,
      actionItems: analysis.actionItems,
      recommendations: analysis.recommendations,
      glossary: analysis.glossary,
      culturalNotes: analysis.culturalNotes,
      suggestedReplies: analysis.suggestedReplies,
      ...(analysis.insights ? { insights: analysis.insights } : {}),
      ...(analysis.issues ? { analysisIssues: analysis.issues } : {}),
    };

    session.status = "ready";
    session.title = report.title.en;
    session.report = report;
    session.estimatedCostUsd = (session.estimatedCostUsd ?? 0) + (analysis.estimatedCostUsd ?? 0);
    delete session.errorMessage;
  } catch (analysisErr) {
    const message = analysisErr instanceof Error ? analysisErr.message : String(analysisErr);
    session.status = "error";
    session.errorMessage = `Transcription succeeded, but analysis failed: ${message}`;
    session.report = {
      title: {
        ja: "文字起こしのみ（分析エラー）",
        en: "Transcript only (analysis failed)",
      },
      mode: session.mode,
      durationMs,
      recordedAt: session.createdAt,
      participants,
      executiveSummary: {
        ja: ["分析に失敗しましたが、文字起こし自体は完了しています。下記をご確認ください。"],
        en: ["Analysis failed, but the transcription itself succeeded — the raw Japanese transcript is below."],
      },
      keyTopics: [],
      actionItems: [],
      recommendations: [],
      glossary: [],
      culturalNotes: [],
      rawTranscript: segments.map(
        (seg): TranscriptLine => ({
          speaker: seg.speaker,
          startMs: seg.startMs,
          endMs: seg.endMs,
          japanese: seg.text,
        })
      ),
    };
  }
}

/**
 * Runs a created session end to end: STT -> analyze -> assemble
 * report, saving progress to the session store as it goes. Deliberately not
 * tied to the request that uploaded the audio — a real recording takes many
 * minutes, far longer than a host will hold one HTTP request open, so
 * api/upload/route.ts runs this after responding and the client polls the
 * session until it's ready.
 */
export async function processSession(
  session: Session,
  params: {
    audio: Blob;
    filename?: string;
    mimeType?: string;
    /** The reader's own words for who they are in the meeting ("藤田, the new contractor"). */
    reader?: string;
    /**
     * The "Try sample recording" button: always forces the mock STT + mock
     * analysis providers, regardless of which real providers are configured.
     * There's no real audio behind the canned demo dialogue, so a real STT
     * provider has nothing valid to transcribe.
     */
    useSample?: boolean;
  }
): Promise<Session> {
  await withHeartbeat(session, async () => {
    const stt = params.useSample ? mockProvider : getSttProvider();
    const transcription = await stt.transcribe(params.audio, {
      language: "ja",
      filename: params.filename,
      mimeType: params.mimeType,
    });
    const transcript: StoredTranscript = {
      segments: transcription.segments,
      durationMs: transcription.durationMs,
      sample: Boolean(params.useSample),
    };

    // Kept so the report can be re-analyzed later without transcribing
    // again. A failure to store it only costs that convenience.
    try {
      await saveTranscript(session.id, transcript);
      session.hasTranscript = true;
    } catch (err) {
      console.error(`Could not store the transcript for session ${session.id}:`, err);
    }

    session.status = "analyzing";
    session.audioDurationSec = Math.round(transcription.durationMs / 1000);
    await saveSession(session);

    await analyzeTranscript(session, transcript, params.reader ?? "");
    await saveSession(session);
  });
  return session;
}

/** Whether a session has a stored transcript that reanalyzeSession() can use. */
export async function loadTranscript(id: string): Promise<StoredTranscript | undefined> {
  return getTranscript(id);
}

/**
 * Rebuilds a session's report from its stored transcript — no audio, no
 * transcription cost. For picking up analysis improvements, retrying parts
 * that failed, or adding the "For you" section once the reader has said
 * who they are. The caller has already marked the session "analyzing".
 */
export async function reanalyzeSession(
  session: Session,
  transcript: StoredTranscript,
  reader: string
): Promise<Session> {
  await withHeartbeat(session, async () => {
    await analyzeTranscript(session, transcript, reader);
    await saveSession(session);
  });
  return session;
}
