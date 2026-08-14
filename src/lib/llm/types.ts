import type {
  ActionItem,
  Bilingual,
  CulturalNote,
  GlossaryTerm,
  KeyTopic,
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
}

export interface AnalysisProvider {
  name: string;
  analyze(lines: AnalysisInputLine[]): Promise<AnalysisResult>;
}
