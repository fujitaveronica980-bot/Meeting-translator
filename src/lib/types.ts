export type SessionMode = "seminar" | "meeting" | "casual";

export type SessionStatus =
  | "uploaded"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

export interface Bilingual {
  ja: string;
  en: string;
}

/** One line of the raw Japanese transcript, as it came back from STT. */
export interface TranscriptLine {
  speaker: string;
  startMs: number;
  endMs: number;
  japanese: string;
}

export interface GlossaryTerm {
  term: string;
  reading: string;
  translation: string;
  note?: string;
  /**
   * One-sentence plain-language definition in each language, for the key
   * terms table of the downloaded summary. Absent on older reports.
   */
  meaning?: Bilingual;
}

/** A takeaway for the downloaded summary: a short headline, then the detail. */
export interface KeyPoint {
  headline: Bilingual;
  detail: Bilingual;
}

export interface KeyTopic {
  title: Bilingual;
  startMs: number;
  endMs: number;
  summary: Bilingual;
  speakers: string[];
}

export interface ActionItem {
  description: Bilingual;
  owner?: string;
  dueHint?: string;
  /** The deadline in each language. Absent on older reports (see dueHint). */
  due?: Bilingual;
}

export interface CulturalNote {
  quote: Bilingual;
  note: string;
}

export interface SuggestedReplyOption {
  japanese: string;
  /** Romanized pronunciation — needed since not everyone reads Japanese. */
  romaji: string;
  english: string;
  /** Short usage note, e.g. "casual/friendly", "polite way to decline". */
  nuance?: string;
}

export interface SuggestedReplyGroup {
  /** Brief bilingual paraphrase of what's being responded to. */
  context: Bilingual;
  options: SuggestedReplyOption[];
}

/** A reply-ready question, in the same shape as a suggested reply. */
export interface FollowUpQuestion {
  japanese: string;
  /** Romanized pronunciation — needed since not everyone reads Japanese. */
  romaji: string;
  english: string;
}

/**
 * The second layer of a report: not what was discussed, but what the reader
 * should take from it and do about it. Produced by a separate analysis call
 * (see llm/gemini.ts), so it is absent on older reports, on casual clips,
 * and whenever that call fails — everything that shows it must cope without.
 */
export interface MeetingInsights {
  /**
   * What the meeting means for the person reading the report — only filled
   * in when they said who they are (the "Who are you" field) and could be
   * found among the speakers.
   */
  forYou: {
    /** Speaker label believed to be the reader ("S2"), or "" if not identified. */
    speaker: string;
    /** One sentence on how the reader was identified, so a wrong guess is visible. */
    basis: Bilingual;
    /** What the reader was asked or is expected to do. */
    asked: Bilingual[];
    /** What the reader said they would do. */
    committed: Bilingual[];
    /** Questions put to the reader, and how they answered. */
    questions: { question: Bilingual; answer: Bilingual }[];
  };
  /** Specifics a summary loses: every number, date, name, tool and rule, stated exactly. */
  details: { category: "number" | "date" | "person" | "tool" | "rule"; detail: Bilingual }[];
  /** Processes or rules that were explained step by step. */
  procedures: { title: Bilingual; steps: { ja: string[]; en: string[] } }[];
  decisions: Bilingual[];
  /** Left unresolved, and who owes the answer (a speaker label or name, "" if nobody). */
  openQuestions: { question: Bilingual; owner: string }[];
  /**
   * Interpretation, not fact: what was meant beyond the literal words, and
   * what the speakers kept returning to. `quote` is the Japanese it rests on.
   */
  betweenTheLines: { point: Bilingual; quote?: string }[];
  followUp: {
    /** A recap message the reader could send afterwards, in polite Japanese, with its English. */
    message: { japanese: string; english: string };
    questions: FollowUpQuestion[];
  };
  /** Who each speaker is, as far as the recording shows. */
  people: { speaker: string; name: string; role: Bilingual; caresAbout: Bilingual }[];
  /** Earlier meetings' open action items that came up again, and where they stand now. */
  carriedOver: { item: Bilingual; status: Bilingual }[];
}

export interface MeetingReport {
  title: Bilingual;
  mode: SessionMode;
  durationMs: number;
  recordedAt: string;
  participants: string[];
  /**
   * `overview` (what the recording was about, in a sentence or two) and
   * `keyPoints` feed the downloaded PDF summary. Both are absent on reports
   * made before the PDF existed — it falls back to executiveSummary.
   */
  overview?: Bilingual;
  keyPoints?: KeyPoint[];
  executiveSummary: { ja: string[]; en: string[] };
  keyTopics: KeyTopic[];
  actionItems: ActionItem[];
  recommendations: Bilingual[];
  glossary: GlossaryTerm[];
  culturalNotes: CulturalNote[];
  /**
   * Reports don't carry the transcript — only the analysis of it. The one
   * exception is when analysis failed: the raw Japanese transcript is kept
   * here so a transcription that was already paid for isn't thrown away.
   */
  rawTranscript?: TranscriptLine[];
  insights?: MeetingInsights;
  /**
   * Optional parts of the report that could not be generated, and why —
   * shown on the page so a missing section is explained rather than silent.
   */
  analysisIssues?: string[];
  /** Casual mode only: example replies you could give back, in the moment. */
  suggestedReplies?: SuggestedReplyGroup[];
}

export interface Session {
  id: string;
  createdAt: string;
  mode: SessionMode;
  status: SessionStatus;
  title?: string;
  audioDurationSec?: number;
  audioFile?: string;
  errorMessage?: string;
  /**
   * Refreshed every half minute while the server is still working on this
   * session. A session that is still "transcribing"/"analyzing" with a stale
   * heartbeat was cut off mid-run (the server restarted — a redeploy, a
   * crash) and will never finish; see api/sessions/[id]/route.ts.
   */
  heartbeatAt?: string;
  /**
   * The transcript is kept server-side (see session-store), so the report
   * can be re-analyzed without paying to transcribe the audio again.
   */
  hasTranscript?: boolean;
  /** Indexes into report.actionItems the reader has ticked off as done. */
  doneActions?: number[];
  report?: MeetingReport;
  /**
   * Estimated USD cost of this session's Gemini calls, from real token
   * usage the API reports per call — not exact billing (STT cost isn't
   * included, and per-model pricing is a maintained lookup table, not
   * fetched live), but grounded in real usage rather than guessed.
   */
  estimatedCostUsd?: number;
}
