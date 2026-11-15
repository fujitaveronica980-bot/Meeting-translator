/**
 * Custom vocabulary: names and terms the speech-to-text provider should
 * expect (company and product names, people, internal jargon). Without
 * this, proper nouns are the most commonly misheard words, and a misheard
 * name then gets carried into every part of the report.
 *
 * Set STT_VOCABULARY to a list separated by commas, Japanese commas (、) or
 * newlines, e.g. "藤田, 株式会社サンプル, Kubernetes, 稟議".
 */

// Speechmatics accepts up to 1000 additional vocabulary entries.
const MAX_ENTRIES = 1000;

export function customVocabulary(raw = process.env.STT_VOCABULARY): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,、\n]/)) {
    const term = part.trim();
    if (term) seen.add(term);
  }
  return Array.from(seen).slice(0, MAX_ENTRIES);
}
