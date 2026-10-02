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
 * only analyzed. `startMs` lets the provider place key topics in time.
 */
export interface AnalysisInputLine {
  speaker: string;
  startMs: number;
  japanese: string;
}

/**
 * Everything an analysis provider derives from a raw diarized transcript to
 * make a full MeetingReport: the report-level bilingual content.
 */
export interface AnalysisResult {
  title: Bilingual;
  executiveSummary: { ja: string[]; en: string[] };
  keyTopics: KeyTopic[];
  actionItems: ActionItem[];
  recommendations: Bilingual[];
  glossary: GlossaryTerm[];
  culturalNotes: CulturalNote[];
  /** Casual mode only — providers should return [] for meeting/seminar. */
  suggestedReplies?: SuggestedReplyGroup[];
  /** Real-usage-based estimate; mock provider omits it (no real cost). */
  estimatedCostUsd?: number;
}

export interface AnalysisProvider {
  name: string;
  /**
   * `mode` matters beyond labeling: it should also steer the analysis
   * register (casual conversation vs. business meeting) and, for "casual",
   * enables suggestedReplies generation.
   */
  analyze(lines: AnalysisInputLine[], mode: SessionMode): Promise<AnalysisResult>;
}
