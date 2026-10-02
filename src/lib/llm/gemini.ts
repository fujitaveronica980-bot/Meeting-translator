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
 * The report comes from four calls that never echo the transcript back —
 * the meeting analysis, two for the insights layer (what the reader should
 * do about it), and one for the summary's overview and key points — so the
 * output stays small and the request count stays the same no matter how
 * long the recording is: an hour-plus meeting costs the same requests as a
 * short one, just with more input tokens. Only the meeting analysis is
 * essential; the others can fail individually (see analyze()). (There
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
You will receive a diarized transcript of ${context} as a JSON array of {speaker, startMs, japanese} lines,
where startMs is when the line begins, in milliseconds from the start of the recording.
Do not reproduce the transcript in your response. Instead, analyze it and produce:
- a short bilingual title
- a bilingual executive summary (3-5 bullet points each language)
- key topics covering the whole recording from start to finish, each with start/end times in
  milliseconds taken from the startMs of the lines it spans
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

type MeetingAnalysis = Omit<
  AnalysisResult,
  "estimatedCostUsd" | "insights" | "overview" | "keyPoints" | "issues"
>;

/**
 * One structured-output call. Every part of the report goes through this,
 * each with its own small schema: a single schema covering everything was
 * too much for the API to serve, and separate calls also mean one part
 * failing costs only that part.
 */
async function generateJson<T>(
  ai: GoogleGenAI,
  model: string,
  what: string,
  systemInstruction: string,
  responseSchema: unknown,
  input: string
): Promise<{ value: T; costUsd: number }> {
  const response = await generateWithRetry(ai, {
    model,
    contents: [{ role: "user", parts: [{ text: input }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: responseSchema as Record<string, unknown>,
    },
  });
  const value = parseJson<T>(response.text, what, response.candidates?.[0]?.finishReason);
  return { value, costUsd: estimateCostUsd(response) };
}

const stringList = { type: Type.ARRAY, items: { type: Type.STRING } };
const bilingualList = { type: Type.ARRAY, items: bilingualSchema };

// --- Summary extras: what the PDF summary adds on top of the meeting analysis.

interface SummaryExtras {
  overview: { ja: string; en: string };
  keyPoints: NonNullable<AnalysisResult["keyPoints"]>;
  termMeanings: { term: string; meaning: { ja: string; en: string } }[];
  deadlines: { index: number; due: { ja: string; en: string } }[];
}

const extrasSchema = {
  type: Type.OBJECT,
  properties: {
    overview: bilingualSchema,
    keyPoints: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { headline: bilingualSchema, detail: bilingualSchema },
        required: ["headline", "detail"],
      },
    },
    termMeanings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { term: { type: Type.STRING }, meaning: bilingualSchema },
        required: ["term", "meaning"],
      },
    },
    deadlines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { index: { type: Type.NUMBER }, due: bilingualSchema },
        required: ["index", "due"],
      },
    },
  },
  required: ["overview", "keyPoints", "termMeanings", "deadlines"],
};

function buildExtrasPrompt(mode: SessionMode, meeting: MeetingAnalysis): string {
  return `You are a professional Japanese conversation analyst writing the front page of a summary for
someone who was not in the ${mode === "seminar" ? "seminar" : "meeting"}.
You will receive the diarized transcript as a JSON array of {speaker, startMs, japanese} lines.
Everything bilingual is written in natural Japanese (ja) and plain English (en). Use only what the
transcript supports.

Produce:
- overview: one or two plain sentences saying what the recording was about and its main outcome.
- keyPoints: 3-6 things a reader most needs to take away — each a short headline that states the
  point as a complete sentence, plus one or two sentences of detail.
- termMeanings: for each of these terms, a one-sentence plain-language definition in each language,
  as the term was used here. Return the term exactly as given.
  Terms: ${JSON.stringify(meeting.glossary.map((g) => g.term))}
- deadlines: for each of these action items that had a deadline mentioned, its index and the deadline
  in each language (e.g. ja "来週火曜まで", en "By next Tuesday"). Leave out items with no deadline.
  Action items: ${JSON.stringify(meeting.actionItems.map((a, index) => ({ index, action: a.description.ja })))}

Respond only with JSON matching the provided schema.`;
}

// --- Insights: the layer about what the reader should do (see MeetingInsights),
// in two calls so neither schema is large.

type InsightsForReader = Pick<
  MeetingInsights,
  "forYou" | "decisions" | "openQuestions" | "people" | "carriedOver"
>;
type InsightsReference = Pick<
  MeetingInsights,
  "details" | "procedures" | "betweenTheLines" | "followUp"
>;

const insightsForReaderSchema = {
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
    decisions: bilingualList,
    openQuestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { question: bilingualSchema, owner: { type: Type.STRING } },
        required: ["question", "owner"],
      },
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
  required: ["forYou", "decisions", "openQuestions", "people", "carriedOver"],
};

const insightsReferenceSchema = {
  type: Type.OBJECT,
  properties: {
    details: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          // One of: number, date, person, tool, rule (asked for in the prompt
          // rather than as an enum, to keep the schema simple to serve).
          category: { type: Type.STRING },
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
  },
  required: ["details", "procedures", "betweenTheLines", "followUp"],
};

function insightsPreamble(mode: SessionMode, context: AnalysisContext): string {
  const reader = context.reader.trim();
  return `You are a sharp chief of staff preparing one person to act on a Japanese ${
    mode === "seminar" ? "seminar" : "business meeting"
  } they attended.
You will receive the diarized transcript as a JSON array of {speaker, startMs, japanese} lines.
A separate summary already covers what was discussed. Your job is the layer a summary loses.
Everything bilingual is written in natural Japanese (ja) and plain English (en).
Use only what the transcript supports. Never invent a number, date, name or commitment; when
something isn't there, return an empty list or an empty string for it.

THE READER
${
  reader
    ? `The person reading this describes themselves as: "${reader}".`
    : "The reader has not said who they are."
}`;
}

function buildInsightsForReaderPrompt(mode: SessionMode, context: AnalysisContext): string {
  const reader = context.reader.trim();
  const { openActions, people, terms } = context.memory;
  const hasMemory = openActions.length > 0 || people.length > 0 || terms.length > 0;

  return `${insightsPreamble(mode, context)}

Produce:
- forYou:${
    reader
      ? `
  Work out which speaker label is the reader — from being addressed by name, introducing
  themselves, or their role in the conversation.
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
- decisions: what was actually decided or agreed.
- openQuestions: what was left unresolved or deferred, with the speaker label or name of whoever
  owes the answer ("" if nobody was named).
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

function buildInsightsReferencePrompt(mode: SessionMode, context: AnalysisContext): string {
  return `${insightsPreamble(mode, context)}

Produce:
- details: every specific that someone would otherwise have to re-listen for — figures, amounts,
  thresholds, dates, times, named people, companies, tools and systems, and stated rules or criteria.
  One self-contained statement each (e.g. "Target companies: annual sales of 10 billion yen or more"),
  with its category: exactly one of "number", "date", "person", "tool", "rule".
  Be thorough: this is a reference sheet, not a summary — but at most 40 entries, the most useful first.
- procedures: any process, format or set of rules that was explained step by step — give the steps
  in order, as precisely as they were explained. Empty if nothing was explained that way.
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

Respond only with JSON matching the provided schema.`;
}

const EMPTY_BILINGUAL = { ja: "", en: "" };
const DETAIL_CATEGORIES = new Set(["number", "date", "person", "tool", "rule"]);

/** A failed part of the report, in words the user can act on or pass along. */
function issue(part: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return `${part} could not be generated: ${reason.replace(/\s+/g, " ").slice(0, 300)}`;
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
    const input = JSON.stringify(lines);
    const issues: string[] = [];
    let costUsd = 0;

    // The meeting analysis is the report; if it fails, the analysis fails.
    // Everything after it is an addition that can go missing on its own —
    // recorded in `issues` so the page can say what's absent and why,
    // instead of the section silently not being there.
    const optional = async <T>(part: string, run: () => Promise<{ value: T; costUsd: number }>) => {
      try {
        const result = await run();
        costUsd += result.costUsd;
        return result.value;
      } catch (err) {
        console.error(`${part} failed:`, err);
        issues.push(issue(part, err));
        return null;
      }
    };

    // Casual clips are short bursts where speed matters and the reader isn't
    // even in the recording, so they get the meeting analysis alone.
    const full = mode !== "casual";

    const [meeting, forReader, reference] = await Promise.all([
      generateJson<MeetingAnalysis>(
        ai,
        model,
        "the meeting analysis",
        buildAnalysisPrompt(mode),
        buildAnalysisSchema(mode),
        input
      ),
      full
        ? optional("The “For you”, decisions and people sections", () =>
            generateJson<InsightsForReader>(
              ai,
              model,
              "the reader insights",
              buildInsightsForReaderPrompt(mode, context),
              insightsForReaderSchema,
              input
            )
          )
        : null,
      full
        ? optional("The details sheet, between-the-lines and follow-up sections", () =>
            generateJson<InsightsReference>(
              ai,
              model,
              "the reference insights",
              buildInsightsReferencePrompt(mode, context),
              insightsReferenceSchema,
              input
            )
          )
        : null,
    ]);
    costUsd += meeting.costUsd;
    const analysis = meeting.value;

    // Needs the meeting analysis first: it defines the terms and action
    // items whose meanings and deadlines this fills in.
    const extras = full
      ? await optional("The overview and key points", () =>
          generateJson<SummaryExtras>(
            ai,
            model,
            "the summary extras",
            buildExtrasPrompt(mode, analysis),
            extrasSchema,
            input
          )
        )
      : null;

    if (extras) {
      const meanings = new Map(extras.termMeanings.map((t) => [t.term, t.meaning]));
      analysis.glossary = analysis.glossary.map((g) =>
        meanings.has(g.term) ? { ...g, meaning: meanings.get(g.term) } : g
      );
      for (const { index, due } of extras.deadlines) {
        if (analysis.actionItems[index]) analysis.actionItems[index].due = due;
      }
    }

    // Whichever half of the insights arrived is kept; the other half is
    // left empty (and explained in `issues`) rather than dropping both.
    const insights: MeetingInsights | undefined =
      forReader || reference
        ? {
            forYou: forReader?.forYou ?? {
              speaker: "",
              basis: EMPTY_BILINGUAL,
              asked: [],
              committed: [],
              questions: [],
            },
            decisions: forReader?.decisions ?? [],
            openQuestions: forReader?.openQuestions ?? [],
            people: forReader?.people ?? [],
            carriedOver: forReader?.carriedOver ?? [],
            details: (reference?.details ?? []).filter((d) => DETAIL_CATEGORIES.has(d.category)),
            procedures: reference?.procedures ?? [],
            betweenTheLines: reference?.betweenTheLines ?? [],
            followUp: reference?.followUp ?? { message: { japanese: "", english: "" }, questions: [] },
          }
        : undefined;

    return {
      ...analysis,
      ...(extras ? { overview: extras.overview, keyPoints: extras.keyPoints } : {}),
      ...(insights ? { insights } : {}),
      ...(issues.length > 0 ? { issues } : {}),
      estimatedCostUsd: costUsd,
    };
  },
};
