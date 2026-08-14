import { ApiError, GoogleGenAI, Type } from "@google/genai";
import type { AnalysisInputLine, AnalysisProvider, AnalysisResult } from "./types";

/**
 * Gemini-backed analysis provider: translates a diarized JA transcript to
 * English and extracts the rest of the bilingual meeting report in a single
 * structured-output call.
 *
 * Uses a free API key from Google AI Studio (https://aistudio.google.com/apikey)
 * — no card required for the free tier as of 2026, but check the current
 * rate/quota limits in AI Studio since they've changed before.
 *
 * Model defaults to the "gemini-flash-latest" alias rather than a pinned
 * version (e.g. gemini-2.5-flash) — pinned versions get retired for new API
 * keys over time ("this model is no longer available to new users"), while
 * the -latest alias always tracks Google's current recommended flash model.
 * Override with GEMINI_MODEL if you want a specific pinned version instead.
 */

const bilingualSchema = {
  type: Type.OBJECT,
  properties: { ja: { type: Type.STRING }, en: { type: Type.STRING } },
  required: ["ja", "en"],
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    title: bilingualSchema,
    transcriptEnglish: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING }, english: { type: Type.STRING } },
        required: ["id", "english"],
      },
    },
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
    "transcriptEnglish",
    "executiveSummary",
    "keyTopics",
    "actionItems",
    "recommendations",
    "glossary",
    "culturalNotes",
  ],
};

const SYSTEM_PROMPT = `You are a professional Japanese-to-English business interpreter and meeting analyst.
You will receive a diarized Japanese meeting transcript as a JSON array of {id, speaker, japanese} lines.
Do not alter the Japanese text. For each line, produce a natural, accurate English translation
(translate meaning and register, not word-for-word). Then analyze the whole meeting and produce:
- a short bilingual title
- a bilingual executive summary (3-5 bullet points each language)
- key topics with approximate start/end times in milliseconds inferred from line order and speaker turns
- action items with an owner when identifiable from context
- concrete recommendations
- a glossary of business/domain terms worth flagging for a non-native speaker, with furigana-style reading and translation
- cultural notes: places where the phrasing carries implicit meaning (softened refusals, indirectness,
  honorifics, etc.) that a non-Japanese reader could easily miss, with a short quote and explanation

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

export const geminiAnalysisProvider: AnalysisProvider = {
  name: "gemini",

  async analyze(lines: AnalysisInputLine[]): Promise<AnalysisResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

    const response = await generateWithRetry(ai, {
      model,
      contents: [
        { role: "user", parts: [{ text: JSON.stringify(lines) }] },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error(
        `Gemini returned no text output (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`
      );
    }

    let parsed: AnalysisResult;
    try {
      parsed = JSON.parse(text) as AnalysisResult;
    } catch {
      throw new Error(`Gemini response was not valid JSON: ${text.slice(0, 500)}`);
    }

    return parsed;
  },
};
