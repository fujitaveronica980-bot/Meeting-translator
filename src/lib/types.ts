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

export interface TranscriptLine {
  id: string;
  speaker: string;
  startMs: number;
  endMs: number;
  japanese: string;
  english: string;
}

export interface GlossaryTerm {
  term: string;
  reading: string;
  translation: string;
  note?: string;
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

export interface MeetingReport {
  title: Bilingual;
  mode: SessionMode;
  durationMs: number;
  recordedAt: string;
  participants: string[];
  executiveSummary: { ja: string[]; en: string[] };
  keyTopics: KeyTopic[];
  actionItems: ActionItem[];
  recommendations: Bilingual[];
  glossary: GlossaryTerm[];
  culturalNotes: CulturalNote[];
  transcript: TranscriptLine[];
  /** Casual mode only: example replies you could give back, in the moment. */
  suggestedReplies?: SuggestedReplyGroup[];
}

export interface QuotaSnapshot {
  sttProvider: string;
  sttMinutesUsedThisMonth: number;
  sttMinutesCapThisMonth: number;
  llmRequestsUsedToday: number;
  llmRequestsCapToday: number;
  periodStart: string;
  warning?: string;
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
  report?: MeetingReport;
}
