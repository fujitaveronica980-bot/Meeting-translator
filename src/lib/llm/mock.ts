import type { SessionMode } from "@/lib/types";
import type { AnalysisInputLine, AnalysisProvider, AnalysisResult } from "./types";

/**
 * Demo/dev provider used automatically when no LLM API key is configured.
 * Mirrors src/lib/stt/mock.ts: lets the whole app be run and evaluated with
 * zero signups and zero cost.
 *
 * It recognizes the fixed dialogue produced by the mock STT provider and
 * returns a hand-written, accurate bilingual analysis for it. For any other
 * input (e.g. a real recording transcribed by a real STT provider, but no
 * GEMINI_API_KEY set) it falls back to a clearly-labeled placeholder
 * translation rather than pretending to translate.
 */

const KNOWN_JAPANESE_TO_ENGLISH: Record<string, string> = {
  "本日はお時間をいただきありがとうございます。早速ですが、新しい価格プランについてご説明させていただきます。":
    "Thank you for making time today. Let's get right into it — I'd like to walk you through our new pricing plan.",
  "はい、よろしくお願いします。御社の新しいプランは来月から適用ということでよろしいでしょうか。":
    "Sure, thanks. Just to confirm, your new plan takes effect starting next month, is that right?",
  "そうですね、基本的には来月からを予定しておりますが、貴社の場合は少し検討させていただければと思います。":
    "That's right, next month is the general schedule, but for your company specifically I'd like to look into some options.",
  "承知しました。ただ、正直に申し上げますと、予算的には少し厳しい状況でして。":
    "Understood. Though to be honest, our budget situation is a bit tight right now.",
  "なるほど、そのあたりは弊社としても柔軟に対応できる部分がございますので、また改めてご相談させてください。":
    "I see. That's an area where we do have some flexibility, so let's revisit it in more detail soon.",
  "ありがとうございます。では次回、具体的な数字を持って再度お話しできればと思います。":
    "Thank you. In that case, let's plan to come back next time with concrete numbers to discuss.",
};

export const mockAnalysisProvider: AnalysisProvider = {
  name: "mock",

  // `_mode` unused: the canned demo dialogue is a fixed business negotiation
  // regardless of mode, so mock has no casual content to draw suggestedReplies
  // from. Real casual-mode replies only come from the Gemini provider.
  async analyze(lines: AnalysisInputLine[], _mode: SessionMode): Promise<AnalysisResult> {
    void _mode;
    const isKnownDialogue = lines.every((l) => l.japanese in KNOWN_JAPANESE_TO_ENGLISH);

    const transcriptEnglish = lines.map((l) => ({
      id: l.id,
      english:
        KNOWN_JAPANESE_TO_ENGLISH[l.japanese] ??
        "[translation unavailable — set GEMINI_API_KEY to enable real translation]",
    }));

    if (!isKnownDialogue) {
      return {
        title: {
          ja: "会議（分析にはGEMINI_API_KEYが必要です）",
          en: "Meeting (set GEMINI_API_KEY for real analysis)",
        },
        transcriptEnglish,
        executiveSummary: {
          ja: ["GEMINI_API_KEY が設定されていないため、要約は生成されていません。"],
          en: ["No GEMINI_API_KEY is configured, so no summary was generated."],
        },
        keyTopics: [],
        actionItems: [],
        recommendations: [],
        glossary: [],
        culturalNotes: [],
      };
    }

    return {
      title: {
        ja: "新価格プランに関する打ち合わせ",
        en: "Discussion on the New Pricing Plan",
      },
      transcriptEnglish,
      executiveSummary: {
        ja: [
          "サプライヤーが新しい価格プランを来月から導入予定であることを説明した。",
          "顧客側は予算的な制約を理由に、適用時期について再検討を依頼した。",
          "双方は次回、具体的な数字をもって再協議することに合意した。",
        ],
        en: [
          "The supplier explained that the new pricing plan is scheduled to take effect next month.",
          "The customer cited budget constraints and asked for flexibility on the timing.",
          "Both sides agreed to reconvene with concrete figures for further discussion.",
        ],
      },
      keyTopics: [
        {
          title: { ja: "新価格プランの適用時期", en: "Timing of the New Pricing Plan" },
          startMs: 0,
          endMs: 13000,
          summary: {
            ja: "S1が新プランは来月からの適用を予定していると説明し、貴社については個別に検討すると述べた。",
            en: "S1 explained the new plan is generally set to start next month, and offered to consider the customer's case individually.",
          },
          speakers: ["S1", "S2"],
        },
        {
          title: { ja: "予算面の懸念と柔軟な対応", en: "Budget Concerns and Flexibility" },
          startMs: 13200,
          endMs: 25000,
          summary: {
            ja: "S2が予算が厳しい状況を伝え、S1は柔軟に対応できる余地があるとして次回改めて協議することを提案した。",
            en: "S2 raised a tight budget situation, and S1 indicated there is room for flexibility, proposing to revisit the topic in the next meeting.",
          },
          speakers: ["S1", "S2"],
        },
      ],
      actionItems: [
        {
          description: {
            ja: "次回打ち合わせまでに、具体的な価格数字を用意する。",
            en: "Prepare concrete pricing figures before the next meeting.",
          },
          owner: "S2",
        },
        {
          description: {
            ja: "貴社向けの柔軟な適用プランについて社内で検討する。",
            en: "Review flexible plan options for this customer internally.",
          },
          owner: "S1",
        },
      ],
      recommendations: [
        {
          ja: "次回は書面で価格提案を共有し、認識のズレを防ぐことを推奨する。",
          en: "Recommend sharing the next pricing proposal in writing to avoid misalignment.",
        },
      ],
      glossary: [
        {
          term: "価格プラン",
          reading: "かかくプラン",
          translation: "pricing plan",
        },
        {
          term: "御社",
          reading: "おんしゃ",
          translation: "your company",
          note: "Polite/formal way to refer to the listener's company in business Japanese.",
        },
      ],
      culturalNotes: [
        {
          quote: {
            ja: "少し検討させていただければと思います。",
            en: "I'd like to look into some options.",
          },
          note:
            "A softened, indirect way of signaling openness to negotiation without committing to specifics — common in Japanese business speech to avoid an outright refusal or premature promise.",
        },
      ],
    };
  },
};
