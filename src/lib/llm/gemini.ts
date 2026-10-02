import { ApiError, GoogleGenAI, Type, type GenerateContentResponse } from "@google/genai";
import type { SessionMode } from "@/lib/types";
import type { MeetingInsights } from "@/lib/types";
import type {
  AnalysisContext,
  AnalysisInputLine,
  AnalysisProvider,
  AnalysisResult,
} from "./types";

/**
 * Gemini-backed analysis provider: turns a diarized JA transcript into the
 * bilingual meeting report.
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
 * The report comes from two calls that never echo the transcript back — the
 * meeting analysis and, in parallel, the insights layer (what the reader
 * should do about it; see analyzeInsights) — so the output stays small and
 * the request count stays at two no matter how long the recording is: an
 * hour-plus meeting costs the same requests as a short one, just with more
 * input tokens. (There
 * used to be a line-by-line English translation of the transcript as well;
 * it took dozens of extra calls on a long recording, any of which could
 * sink the whole report, and the transcript is no longer shown.)
 *
 * `mode` steers the call: the analysis register adapts to a casual
 * conversation vs. a business meeting, and "casual" additionally
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

/**
 * `extended` adds the fields the PDF summary uses (overview, key points,
 * bilingual deadlines, term meanings). The schema without them is the one
 * that has been running in production; analyzeMeeting() falls back to it
 * if the extended one is rejected, so a schema problem can never cost a
 * report that used to work.
 */
function buildAnalysisSchema(mode: SessionMode, extended: boolean) {
  const properties: Record<string, unknown> = {
    title: bilingualSchema,
    ...(extended
      ? {
          overview: bilingualSchema,
          keyPoints: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { headline: bilingualSchema, detail: bilingualSchema },
              required: ["headline", "detail"],
            },
          },
        }
      : {}),
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
          ...(extended ? { due: bilingualSchema } : {}),
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
          ...(extended ? { meaning: bilingualSchema } : {}),
        },
        required: ["term", "reading", "translation", ...(extended ? ["meaning"] : [])],
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
    ...(extended ? ["overview", "keyPoints"] : []),
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
You will receive a diarized transcript of ${context} as a JSON array of {speaker, startMs, japanese} lines,
where startMs is when the line begins, in milliseconds from the start of the recording.
Do not reproduce the transcript in your response. Instead, analyze it and produce:
- a short bilingual title
- a bilingual overview: one or two plain sentences saying what the recording was about and its main
  outcome, written for someone who was not there
- 3-6 bilingual key points, the things a reader most needs to take away: each a short headline that
  states the point as a complete sentence, plus one or two sentences of detail
- a bilingual executive summary (3-5 bullet points each language)
- key topics covering the whole recording from start to finish, each with start/end times in
  milliseconds taken from the startMs of the lines it spans
- action items with an owner when identifiable from context (leave empty if this doesn't apply, e.g. casual chat);
  when a deadline was mentioned give it in "due" in both languages (e.g. ja "来週火曜まで", en "By next Tuesday"),
  and leave "due" out when none was
- concrete recommendations (or conversational suggestions, if casual)
- a glossary of notable terms worth flagging for a non-native speaker, with furigana-style reading and
  translation, and a "meaning": a one-sentence plain-language definition of the term in each language
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

type MeetingAnalysis = Omit<AnalysisResult, "estimatedCostUsd" | "insights">;

async function analyzeMeetingWith(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[],
  mode: SessionMode,
  extended: boolean
): Promise<{ analysis: MeetingAnalysis; costUsd: number }> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(lines) }] }],
    config: {
      systemInstruction: buildAnalysisPrompt(mode),
      responseMimeType: "application/json",
      responseSchema: buildAnalysisSchema(mode, extended),
    },
  });
  const analysis = parseJson<MeetingAnalysis>(
    response.text,
    "the meeting analysis",
    response.candidates?.[0]?.finishReason
  );
  return { analysis, costUsd: estimateCostUsd(response) };
}

async function analyzeMeeting(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[],
  mode: SessionMode
): Promise<{ analysis: MeetingAnalysis; costUsd: number }> {
  try {
    return await analyzeMeetingWith(ai, model, lines, mode, true);
  } catch (err) {
    console.error("Extended meeting analysis failed; retrying with the basic schema:", err);
    return analyzeMeetingWith(ai, model, lines, mode, false);
  }
}

const stringList = { type: Type.ARRAY, items: { type: Type.STRING } };
const bilingualList = { type: Type.ARRAY, items: bilingualSchema };

const insightsSchema = {
  type: Type.OBJECT,
  properties: {
    forYou: {
      type: Type.OBJECT,
      properties: {
        speaker: { type: Type.STRING },
        basis: bilingualSchema,
        asked: bilingualList,
        committed: bilingualList,
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { question: bilingualSchema, answer: bilingualSchema },
            required: ["question", "answer"],
          },
        },
      },
      required: ["speaker", "basis", "asked", "committed", "questions"],
    },
    details: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: ["number", "date", "person", "tool", "rule"] },
          detail: bilingualSchema,
        },
        required: ["category", "detail"],
      },
    },
    procedures: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: bilingualSchema,
          steps: {
            type: Type.OBJECT,
            properties: { ja: stringList, en: stringList },
            required: ["ja", "en"],
          },
        },
        required: ["title", "steps"],
      },
    },
    decisions: bilingualList,
    openQuestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { question: bilingualSchema, owner: { type: Type.STRING } },
        required: ["question", "owner"],
      },
    },
    betweenTheLines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { point: bilingualSchema, quote: { type: Type.STRING } },
        required: ["point"],
      },
    },
    followUp: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.OBJECT,
          properties: { japanese: { type: Type.STRING }, english: { type: Type.STRING } },
          required: ["japanese", "english"],
        },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              japanese: { type: Type.STRING },
              romaji: { type: Type.STRING },
              english: { type: Type.STRING },
            },
            required: ["japanese", "romaji", "english"],
          },
        },
      },
      required: ["message", "questions"],
    },
    people: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING },
          name: { type: Type.STRING },
          role: bilingualSchema,
          caresAbout: bilingualSchema,
        },
        required: ["speaker", "name", "role", "caresAbout"],
      },
    },
    carriedOver: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { item: bilingualSchema, status: bilingualSchema },
        required: ["item", "status"],
      },
    },
  },
  required: [
    "forYou",
    "details",
    "procedures",
    "decisions",
    "openQuestions",
    "betweenTheLines",
    "followUp",
    "people",
    "carriedOver",
  ],
};

function buildInsightsPrompt(mode: SessionMode, context: AnalysisContext): string {
  const reader = context.reader.trim();
  const { openActions, people, terms } = context.memory;
  const hasMemory = openActions.length > 0 || people.length > 0 || terms.length > 0;

  return `You are a sharp chief of staff preparing one person to act on a Japanese ${
    mode === "seminar" ? "seminar" : "business meeting"
  } they attended.
You will receive the diarized transcript as a JSON array of {speaker, startMs, japanese} lines.
A separate summary already covers what was discussed. Your job is the layer a summary loses: what
the reader must do, the exact specifics, what was really meant, and how to follow up.
Everything bilingual is written in natural Japanese (ja) and plain English (en).
Use only what the transcript supports. Never invent a number, date, name or commitment; when
something isn't there, return an empty list or an empty string for it.

THE READER
${
  reader
    ? `The person reading this describes themselves as: "${reader}".
Work out which speaker label is the reader — from being addressed by name, introducing themselves,
or their role in the conversation.`
    : "The reader has not said who they are."
}

Produce:
- forYou:${
    reader
      ? `
  - speaker: the reader's speaker label (e.g. "S2"), or "" if they cannot be identified with
    reasonable confidence or do not speak
  - basis: one sentence on how you identified them (or why you could not)
  - asked: everything the reader was asked, told or clearly expected to do, each with its deadline
    if one was given
  - committed: everything the reader themselves said they would do
  - questions: questions put to the reader, with how the reader answered
  If speaker is "", leave asked, committed and questions empty.`
      : `
  speaker "", basis saying the reader did not say who they are, and asked, committed and questions empty.`
  }
- details: every specific that someone would otherwise have to re-listen for — figures, amounts,
  thresholds, dates, times, named people, companies, tools and systems, and stated rules or criteria.
  One self-contained statement each (e.g. "Target companies: annual sales of 10 billion yen or more"),
  with its category. Be exhaustive here; this is a reference sheet, not a summary.
- procedures: any process, format or set of rules that was explained step by step — give the steps
  in order, as precisely as they were explained. Empty if nothing was explained that way.
- decisions: what was actually decided or agreed.
- openQuestions: what was left unresolved or deferred, with the speaker label or name of whoever
  owes the answer ("" if nobody was named).
- betweenTheLines: what was meant beyond the literal words — a soft phrase that was really a request
  or a refusal, what a speaker kept returning to or spent the most time on, an unstated expectation
  or concern. Each is your interpretation: say what you infer and why, and give the Japanese phrase
  it rests on in "quote" when there is one. Leave out anything you are not reasonably confident of.
- followUp:
  - message: a short recap message the reader could send to the other participants afterwards, in
    polite business Japanese — thanks, their understanding of the main points, and the actions they
    will take — plus an accurate English version of it. Written in the reader's voice.
  - questions: 2-4 good questions the reader could ask next time that show they understood and
    thought ahead, each in Japanese, romaji (the reader may not read Japanese fluently) and English.
- people: one entry per speaker — their label, their name if the recording gives it ("" otherwise;
  never guess), their role, and what they appear to care about most in this conversation.
- carriedOver: see below.

EARLIER MEETINGS
${
  hasMemory
    ? `This is what earlier recordings established (JSON):
${JSON.stringify({ openActionItems: openActions, knownPeople: people, knownTerms: terms })}
For carriedOver, list only the earlier open action items that came up again in THIS recording, each
with where it stands now. Leave it empty if none were mentioned — do not report on items that
were not discussed. Use the known people and terms to recognise names and vocabulary.`
    : "There are no earlier recordings. Return carriedOver as an empty list."
}

Respond only with JSON matching the provided schema.`;
}

/**
 * The second layer of the report (see MeetingInsights). A separate call from
 * the meeting analysis so that it can fail on its own: the summary is what
 * the STT money was spent to get, and a problem here must never take it down.
 */
async function analyzeInsights(
  ai: GoogleGenAI,
  model: string,
  lines: AnalysisInputLine[],
  mode: SessionMode,
  context: AnalysisContext
): Promise<{ insights: MeetingInsights; costUsd: number }> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(lines) }] }],
    config: {
      systemInstruction: buildInsightsPrompt(mode, context),
      responseMimeType: "application/json",
      responseSchema: insightsSchema,
    },
  });
  const insights = parseJson<MeetingInsights>(
    response.text,
    "the meeting insights",
    response.candidates?.[0]?.finishReason
  );
  return { insights, costUsd: estimateCostUsd(response) };
}

export const geminiAnalysisProvider: AnalysisProvider = {
  name: "gemini",

  async analyze(
    lines: AnalysisInputLine[],
    mode: SessionMode,
    context: AnalysisContext
  ): Promise<AnalysisResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

    // Casual clips are short bursts where speed matters and the reader isn't
    // even in the recording, so they skip the insights layer.
    const [meeting, extra] = await Promise.all([
      analyzeMeeting(ai, model, lines, mode),
      mode === "casual"
        ? null
        : analyzeInsights(ai, model, lines, mode, context).catch((err) => {
            console.error("Meeting insights failed; the report goes out without them:", err);
            return null;
          }),
    ]);

    return {
      ...meeting.analysis,
      ...(extra ? { insights: extra.insights } : {}),
      estimatedCostUsd: meeting.costUsd + (extra?.costUsd ?? 0),
    };
  },
};
