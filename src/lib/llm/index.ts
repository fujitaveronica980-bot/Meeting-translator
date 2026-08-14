import type { AnalysisProvider } from "./types";
import { geminiAnalysisProvider } from "./gemini";
import { mockAnalysisProvider } from "./mock";

export type { AnalysisProvider, AnalysisInputLine, AnalysisResult } from "./types";

/**
 * Provider is selected via LLM_PROVIDER, mirroring src/lib/stt/index.ts, so
 * the pipeline never hard-codes a vendor. Falls back to the mock provider
 * (zero cost, zero signup) whenever no key is configured.
 */
export function getAnalysisProvider(): AnalysisProvider {
  const provider = (process.env.LLM_PROVIDER || "").toLowerCase();

  if (provider === "gemini") return geminiAnalysisProvider;
  if (provider === "mock") return mockAnalysisProvider;

  if (process.env.GEMINI_API_KEY) return geminiAnalysisProvider;

  return mockAnalysisProvider;
}
