import type {
  ActionItem,
  Bilingual,
  CulturalNote,
  GlossaryTerm,
  KeyTopic,
  SessionMode,
  SuggestedReplyGroup,
} from "@/lib/types";

/**
 * A single transcribed line handed to the analysis provider. `japanese` is
 * treated as ground truth from STT and is never rewritten by the provider —
 * only translated and analyzed.
 */
export interface AnalysisInputLine {
  id: string;
  speaker: string;
  japanese: string;
}

/**
 * Everything an analysis provider needs to add on top of a raw diarized
 * transcript to make it a full MeetingReport: per-line English translation
 * plus the report-level bilingual content.
 */
export interface AnalysisResult {
  title: Bilingual;
  transcriptEnglish: { id: string; english: string }[];
  executiveSummary: { ja: string[]; en: string[] };
  keyTopics: KeyTopic[];
  actionItems: ActionItem[];
  recommendations: Bilingual[];
  glossary: GlossaryTerm[];
  culturalNotes: CulturalNote[];
  /** Casual mode only — providers should return [] for meeting/seminar. */
  suggestedReplies?: SuggestedReplyGroup[];
}

export interface AnalysisProvider {
  name: string;
  /**
   * `mode` matters beyond labeling: it should also steer translation/analysis
   * register (casual conversation vs. business meeting) and, for "casual",
   * enables suggestedReplies generation.
   */
  analyze(lines: AnalysisInputLine[], mode: SessionMode): Promise<AnalysisResult>;
}
