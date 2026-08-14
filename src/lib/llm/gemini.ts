import { ApiError, GoogleGenAI, Type, type GenerateContentResponse } from "@google/genai";
import type { SessionMode } from "@/lib/types";
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
 *
 * `mode` steers both calls: translation/analysis register adapts to a
 * casual conversation vs. a business meeting, and "casual" additionally
 * requests suggestedReplies — example things you could say back, meant for
 * short recorded bursts during a live conversation rather than post-hoc
 * meeting review.
 */

const bilingualSchema = {
  type: Type.OBJECT,
  properties: { ja: { type: Type.STRING }, en: { type: Type.STRING } },
  required: ["ja", "en"],
};

const suggestedRepliesSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      context: bilingualSchema,
      options: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            japanese: { type: Type.STRING },
            romaji: { type: Type.STRING },
            english: { type: Type.STRING },
            nuance: { type: Type.STRING },
          },
          required: ["japanese", "romaji", "english"],
        },
      },
    },
    required: ["context", "options"],
  },
};

function buildAnalysisSchema(mode: SessionMode) {
  const properties: Record<string, unknown> = {
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
  };

  const required = [
    "title",
    "executiveSummary",
    "keyTopics",
    "actionItems",
    "recommendations",
    "glossary",
    "culturalNotes",
  ];

  // Only requested (and only counted in output tokens) for casual mode —
  // meeting/seminar schema/cost stay exactly as before.
  if (mode === "casual") {
    properties.suggestedReplies = suggestedRepliesSchema;
    required.push("suggestedReplies");
  }

  return { type: Type.OBJECT, properties, required };
}

function buildAnalysisPrompt(mode: SessionMode): string {
  const context =
    mode === "casual"
      ? "an informal conversation between friends or acquaintances"
      : "a Japanese business meeting";

  let prompt = `You are a professional Japanese conversation analyst.
You will receive a diarized transcript of ${context} as a JSON array of {id, speaker, japanese} lines.
Do not reproduce the transcript in your response. Instead, analyze it and produce:
- a short bilingual title
- a bilingual executive summary (3-5 bullet points each language)
- key topics with approximate start/end times in milliseconds inferred from line order and speaker turns
- action items with an owner when identifiable from context (leave empty if this doesn't apply, e.g. casual chat)
- concrete recommendations (or conversational suggestions, if casual)
- a glossary of notable terms worth flagging for a non-native speaker, with furigana-style reading and translation
- cultural notes: places where the phrasing carries implicit meaning (softened refusals, indirectness,
  honorifics, etc.) that a non-Japanese reader could easily miss, with a short quote and explanation`;

  if (mode === "casual") {
    prompt += `

This is a SHORT BURST from a live casual conversation — the user recorded just what the OTHER
PERSON said (never the user's own voice — every speaker in this transcript is someone the user
needs to reply to) and needs help replying, in the moment, before recording the next bit.

Additionally produce suggestedReplies. The clip may be a single remark, or the other person's turn
may itself contain multiple points, a pause-and-continue, or more than one speaker (e.g. two other
people talking, or one person responding to what another just said). Don't blend everything into
one vague group — produce one group per distinct point that's worth a reply, in the order they
happened, with the most recent one last (that's most likely what the user needs to respond to right
now). If a group is clearly attributable to one speaker, name them in the context (e.g. "S2 asked
whether..."). For each group:
- context: a brief bilingual paraphrase of what's being responded to
- options: 2-4 natural, casual (not overly formal/keigo) Japanese replies the user could say back,
  each with japanese text, romaji (the user cannot read Japanese, romaji is how they'll pronounce it
  out loud), an English gloss, and an optional short nuance note (e.g. "casual/friendly", "polite way
  to decline") to help them pick the right one for the moment.`;
  }

  prompt += "\n\nRespond only with JSON matching the provided schema.";
  return prompt;
}

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

function buildTranslationPrompt(mode: SessionMode): string {
  const context =
    mode === "casual"
      ? "a casual, informal conversation between friends or acquaintances"
      : "one business meeting";

  return `You are a professional Japanese-to-English interpreter.
You will receive a JSON array of {id, speaker, japanese} lines from ${context}.
For each line, produce a natural, accurate English translation (translate meaning and register,
not word-for-word — keep it casual/conversational if the source is casual, not stiffly formal).
Do not alter or omit any line — return exactly one translation per input id.
Respond only with JSON matching the provided schema.`;
}

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

// USD per 1M tokens. Not fetched live — a maintained estimate, so this is a
// "roughly how much" figure, not exact billing (check
// https://ai.google.dev/gemini-api/docs/pricing for that). Ordered most-
// specific first since e.g. "2.5-flash-lite" also contains "2.5-flash".
const PRICING_PER_MILLION_TOKENS: { match: string; input: number; output: number }[] = [
  { match: "3.5-flash-lite", input: 0.3, output: 2.5 },
  { match: "3.1-flash-lite", input: 0.25, output: 1.5 },
  { match: "2.5-flash-lite", input: 0.1, output: 0.4 },
  { match: "flash-lite", input: 0.25, output: 1.5 },
  { match: "3.7-flash", input: 0.75, output: 3.75 },
  { match: "3.6-flash", input: 0.75, output: 3.75 },
  { match: "3.5-flash", input: 1.5, output: 9.0 },
  { match: "2.5-flash", input: 0.3, output: 2.5 },
  { match: "flash", input: 0.75, output: 3.75 },
];

function estimateCostUsd(response: GenerateContentResponse): number {
  const usage = response.usageMetadata;
  if (!usage) return 0;
  const modelVersion = response.modelVersion || "";
  const pricing =
    PRICING_PER_MILLION_TOKENS.find((p) => modelVersion.includes(p.match)) ??
    PRICING_PER_MILLION_TOKENS.find((p) => p.match === "flash-lite")!;

  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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
  chunk: AnalysisInputLine[],
  mode: SessionMode
): Promise<{ translations: { id: string; english: string }[]; costUsd: number }> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(chunk) }] }],
    config: {
      systemInstruction: buildTranslationPrompt(mode),
      responseMimeType: "application/json",
      responseSchema: translationSchema,
    },
  });
  const parsed = parseJson<{ translations: { id: string; english: string }[] }>(
    response.text,
    "a translation chunk",
    response.candidates?.[0]?.finishReason
  );
  return { translations: parsed.translations, costUsd: estimateCostUsd(response) };
}

async function translateAll(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[],
  mode: SessionMode
): Promise<{ translations: { id: string; english: string }[]; costUsd: number }> {
  const chunks: AnalysisInputLine[][] = [];
  for (let i = 0; i < lines.length; i += TRANSLATE_CHUNK_SIZE) {
    chunks.push(lines.slice(i, i + TRANSLATE_CHUNK_SIZE));
  }

  const results: { id: string; english: string }[][] = new Array(chunks.length);
  let costUsd = 0;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < chunks.length) {
      const i = nextIndex++;
      const chunkResult = await translateChunk(ai, model, chunks[i], mode);
      results[i] = chunkResult.translations;
      costUsd += chunkResult.costUsd;
    }
  }
  const workerCount = Math.min(TRANSLATE_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { translations: results.flat(), costUsd };
}

async function analyzeMeeting(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[],
  mode: SessionMode
): Promise<{ analysis: Omit<AnalysisResult, "transcriptEnglish" | "estimatedCostUsd">; costUsd: number }> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(lines) }] }],
    config: {
      systemInstruction: buildAnalysisPrompt(mode),
      responseMimeType: "application/json",
      responseSchema: buildAnalysisSchema(mode),
    },
  });
  const analysis = parseJson<Omit<AnalysisResult, "transcriptEnglish" | "estimatedCostUsd">>(
    response.text,
    "the meeting analysis",
    response.candidates?.[0]?.finishReason
  );
  return { analysis, costUsd: estimateCostUsd(response) };
}

export const geminiAnalysisProvider: AnalysisProvider = {
  name: "gemini",

  async analyze(lines: AnalysisInputLine[], mode: SessionMode): Promise<AnalysisResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

    const [translation, meeting] = await Promise.all([
      translateAll(ai, model, lines, mode),
      analyzeMeeting(ai, model, lines, mode),
    ]);

    return {
      ...meeting.analysis,
      transcriptEnglish: translation.translations,
      estimatedCostUsd: translation.costUsd + meeting.costUsd,
    };
  },
};
