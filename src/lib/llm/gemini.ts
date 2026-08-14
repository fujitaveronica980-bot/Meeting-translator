import { ApiError, GoogleGenAI, Type } from "@google/genai";
import type {
  AnalysisInputLine,
  AnalysisProvider,
  AnalysisResult,
} from "./types";

/**
 * Gemini-backed analysis provider: translates a diarized JA transcript to
 * English and extracts the rest of the bilingual meeting report.
 *
 * Uses an API key from Google AI Studio (https://aistudio.google.com/apikey).
 * The free tier caps out at a very small number of requests per day per
 * model (as low as ~20/day as of 2026) — fine for trying the app, but real
 * use (especially long recordings) needs billing enabled on the underlying
 * Google Cloud project to move to pay-as-you-go rate limits. Check current
 * pricing/limits at https://ai.google.dev/gemini-api/docs/pricing.
 *
 * Model defaults to the "gemini-flash-lite-latest" alias rather than a
 * pinned version (e.g. gemini-2.5-flash) — pinned versions get retired for
 * new API keys over time ("this model is no longer available to new
 * users"), while the -latest alias always tracks Google's current
 * recommended model, and flash-lite is the cheapest tier that's still solid
 * for translation/extraction work. Override with GEMINI_MODEL if needed.
 *
 * Translation is done in small chunks (rather than one call asking for the
 * whole transcript back) so a long meeting can't produce one giant, fragile
 * response that risks truncation or a slow timeout — each chunk's output
 * stays small and bounded regardless of meeting length. The report-level
 * analysis (summary/topics/action items/etc.) is a separate call that never
 * echoes the transcript back, so its output also stays small regardless of
 * length; it runs in parallel with translation since neither depends on the
 * other's output.
 */

const bilingualSchema = {
  type: Type.OBJECT,
  properties: { ja: { type: Type.STRING }, en: { type: Type.STRING } },
  required: ["ja", "en"],
};

const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    title: bilingualSchema,
    executiveSummary: {
      type: Type.OBJECT,
      properties: {
        ja: { type: Type.ARRAY, items: { type: Type.STRING } },
        en: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["ja", "en"],
    },
    keyTopics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: bilingualSchema,
          startMs: { type: Type.NUMBER },
          endMs: { type: Type.NUMBER },
          summary: bilingualSchema,
          speakers: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "startMs", "endMs", "summary", "speakers"],
      },
    },
    actionItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: bilingualSchema,
          owner: { type: Type.STRING },
          dueHint: { type: Type.STRING },
        },
        required: ["description"],
      },
    },
    recommendations: { type: Type.ARRAY, items: bilingualSchema },
    glossary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          reading: { type: Type.STRING },
          translation: { type: Type.STRING },
          note: { type: Type.STRING },
        },
        required: ["term", "reading", "translation"],
      },
    },
    culturalNotes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { quote: bilingualSchema, note: { type: Type.STRING } },
        required: ["quote", "note"],
      },
    },
  },
  required: [
    "title",
    "executiveSummary",
    "keyTopics",
    "actionItems",
    "recommendations",
    "glossary",
    "culturalNotes",
  ],
};

const ANALYSIS_SYSTEM_PROMPT = `You are a professional Japanese business meeting analyst.
You will receive a diarized Japanese meeting transcript as a JSON array of {id, speaker, japanese} lines.
Do not reproduce the transcript in your response. Instead, analyze the whole meeting and produce:
- a short bilingual title
- a bilingual executive summary (3-5 bullet points each language)
- key topics with approximate start/end times in milliseconds inferred from line order and speaker turns
- action items with an owner when identifiable from context
- concrete recommendations
- a glossary of business/domain terms worth flagging for a non-native speaker, with furigana-style reading and translation
- cultural notes: places where the phrasing carries implicit meaning (softened refusals, indirectness,
  honorifics, etc.) that a non-Japanese reader could easily miss, with a short quote and explanation

Respond only with JSON matching the provided schema.`;

const translationSchema = {
  type: Type.OBJECT,
  properties: {
    translations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING }, english: { type: Type.STRING } },
        required: ["id", "english"],
      },
    },
  },
  required: ["translations"],
};

const TRANSLATION_SYSTEM_PROMPT = `You are a professional Japanese-to-English business interpreter.
You will receive a JSON array of {id, speaker, japanese} lines from one meeting.
For each line, produce a natural, accurate English translation (translate meaning and register,
not word-for-word). Do not alter or omit any line — return exactly one translation per input id.
Respond only with JSON matching the provided schema.`;

// The free tier occasionally returns 503 ("high demand, try again later") or
// 429 (rate limited) — both are transient and worth a couple of retries
// rather than failing the whole session outright.
const RETRYABLE_STATUS = new Set([429, 503]);
const RETRY_DELAYS_MS = [2000, 5000];

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      const retryable = err instanceof ApiError && RETRYABLE_STATUS.has(err.status);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

function parseJson<T>(text: string | undefined, context: string, finishReason?: string): T {
  if (!text) {
    throw new Error(`Gemini returned no text output for ${context} (finishReason: ${finishReason ?? "unknown"})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini response for ${context} was not valid JSON: ${text.slice(0, 500)}`);
  }
}

// Chunk size chosen so a single translation call's output stays small and
// fast regardless of how long the overall meeting is; concurrency bounds
// how many chunks are in flight at once so a long meeting doesn't fire off
// dozens of simultaneous requests.
const TRANSLATE_CHUNK_SIZE = 40;
const TRANSLATE_CONCURRENCY = 3;

async function translateChunk(
  ai: GoogleGenAI,
  model: string,
  chunk: AnalysisInputLine[]
): Promise<{ id: string; english: string }[]> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(chunk) }] }],
    config: {
      systemInstruction: TRANSLATION_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: translationSchema,
    },
  });
  const parsed = parseJson<{ translations: { id: string; english: string }[] }>(
    response.text,
    "a translation chunk",
    response.candidates?.[0]?.finishReason
  );
  return parsed.translations;
}

async function translateAll(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[]
): Promise<{ id: string; english: string }[]> {
  const chunks: AnalysisInputLine[][] = [];
  for (let i = 0; i < lines.length; i += TRANSLATE_CHUNK_SIZE) {
    chunks.push(lines.slice(i, i + TRANSLATE_CHUNK_SIZE));
  }

  const results: { id: string; english: string }[][] = new Array(chunks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < chunks.length) {
      const i = nextIndex++;
      results[i] = await translateChunk(ai, model, chunks[i]);
    }
  }
  const workerCount = Math.min(TRANSLATE_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results.flat();
}

async function analyzeMeeting(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[]
): Promise<Omit<AnalysisResult, "transcriptEnglish">> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(lines) }] }],
    config: {
      systemInstruction: ANALYSIS_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: analysisSchema,
    },
  });
  return parseJson(response.text, "the meeting analysis", response.candidates?.[0]?.finishReason);
}

export const geminiAnalysisProvider: AnalysisProvider = {
  name: "gemini",

  async analyze(lines: AnalysisInputLine[]): Promise<AnalysisResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

    const [transcriptEnglish, analysis] = await Promise.all([
      translateAll(ai, model, lines),
      analyzeMeeting(ai, model, lines),
    ]);

    return { ...analysis, transcriptEnglish };
  },
};
