import type { SessionMode } from "@/lib/types";
import type { MeetingInsights } from "@/lib/types";
import type { AnalysisContext, AnalysisInputLine, AnalysisProvider, AnalysisResult } from "./types";

/**
 * Demo/dev provider used automatically when no LLM API key is configured.
 * Mirrors src/lib/stt/mock.ts: lets the whole app be run and evaluated with
 * zero signups and zero cost.
 *
 * It recognizes the fixed dialogue produced by the mock STT provider and
 * returns a hand-written, accurate bilingual analysis for it. For any other
 * input (e.g. a real recording transcribed by a real STT provider, but no
 * GEMINI_API_KEY set) it falls back to a clearly-labeled placeholder
 * report rather than pretending to analyze.
 */

const KNOWN_DIALOGUE = new Set([
  "本日はお時間をいただきありがとうございます。早速ですが、新しい価格プランについてご説明させていただきます。",
  "はい、よろしくお願いします。御社の新しいプランは来月から適用ということでよろしいでしょうか。",
  "そうですね、基本的には来月からを予定しておりますが、貴社の場合は少し検討させていただければと思います。",
  "承知しました。ただ、正直に申し上げますと、予算的には少し厳しい状況でして。",
  "なるほど、そのあたりは弊社としても柔軟に対応できる部分がございますので、また改めてご相談させてください。",
  "ありがとうございます。では次回、具体的な数字を持って再度お話しできればと思います。",
]);

/**
 * Hand-written insights for the demo dialogue. The sample casts the reader
 * as S2 (the customer) whenever they've said who they are, so the "For you"
 * section has something to show.
 */
function sampleInsights(context: AnalysisContext): MeetingInsights {
  const identified = context.reader.trim() !== "";
  return {
    forYou: {
      speaker: identified ? "S2" : "",
      basis: identified
        ? {
            ja: "サンプルの会話では、顧客側のS2を読み手として扱っています。",
            en: "In the sample dialogue, the customer (S2) is treated as the reader.",
          }
        : {
            ja: "読み手が誰かが入力されていません。",
            en: "The reader has not said who they are.",
          },
      asked: identified
        ? [
            {
              ja: "次回の打ち合わせで、価格について改めて相談に応じること。",
              en: "Be ready to discuss pricing again at the next meeting.",
            },
          ]
        : [],
      committed: identified
        ? [
            {
              ja: "次回、具体的な数字を持って再度話し合う。",
              en: "Come back next time with concrete figures.",
            },
          ]
        : [],
      questions: [],
    },
    details: [
      {
        category: "date",
        detail: {
          ja: "新価格プランの適用開始：原則として来月から。",
          en: "New pricing plan start: next month, as a general rule.",
        },
      },
      {
        category: "rule",
        detail: {
          ja: "この顧客については適用時期を個別に検討する。",
          en: "For this customer, the start date will be considered individually.",
        },
      },
    ],
    procedures: [],
    decisions: [
      {
        ja: "次回、具体的な数字をもとに再協議する。",
        en: "Reconvene next time with concrete figures.",
      },
    ],
    openQuestions: [
      {
        question: {
          ja: "この顧客への適用時期をいつにするか。",
          en: "When the new plan will apply to this customer.",
        },
        owner: "S1",
      },
    ],
    betweenTheLines: [
      {
        point: {
          ja: "「予算的には少し厳しい」は、値上げをそのままでは受け入れられないという遠回しな意思表示とみられます。",
          en: "\"Our budget is a bit tight\" is likely an indirect way of saying the increase can't be accepted as it stands.",
        },
        quote: "正直に申し上げますと、予算的には少し厳しい状況でして。",
      },
      {
        point: {
          ja: "S1は条件を譲る余地があることを示唆しつつ、具体的な約束は避けています。",
          en: "S1 signals there is room to move on terms while avoiding any specific promise.",
        },
        quote: "柔軟に対応できる部分がございます",
      },
    ],
    followUp: {
      message: {
        japanese:
          "本日はお時間をいただきありがとうございました。新価格プランは原則来月から適用とのこと、承知いたしました。弊社の予算状況を踏まえ、適用時期についてご検討いただけるとのことで感謝申し上げます。次回は具体的な数字を持参いたしますので、引き続きよろしくお願いいたします。",
        english:
          "Thank you for your time today. I understand the new pricing plan generally takes effect next month. I appreciate your willingness to consider the timing in light of our budget situation. I will bring concrete figures next time, and look forward to continuing the discussion.",
      },
      questions: [
        {
          japanese: "適用時期を延ばしていただく場合、どのくらいの期間が可能でしょうか。",
          romaji: "Tekiyou jiki o nobashite itadaku baai, dono kurai no kikan ga kanou deshou ka.",
          english: "If the start date can be pushed back, how long a delay would be possible?",
        },
        {
          japanese: "次回までに、こちらで準備しておくべき資料はありますか。",
          romaji: "Jikai made ni, kochira de junbi shite oku beki shiryou wa arimasu ka.",
          english: "Is there anything we should prepare before the next meeting?",
        },
      ],
    },
    people: [
      {
        speaker: "S1",
        name: "",
        role: { ja: "サプライヤー側の担当者", en: "Supplier-side representative" },
        caresAbout: {
          ja: "新価格プランを導入しつつ、顧客との関係を保つこと。",
          en: "Introducing the new pricing while keeping the customer relationship intact.",
        },
      },
      {
        speaker: "S2",
        name: "",
        role: { ja: "顧客側の担当者", en: "Customer-side representative" },
        caresAbout: {
          ja: "予算内に収めること、適用時期の猶予。",
          en: "Staying within budget and getting more time before the new plan applies.",
        },
      },
    ],
    carriedOver: [],
  };
}

export const mockAnalysisProvider: AnalysisProvider = {
  name: "mock",

  // `_mode` unused: the canned demo dialogue is a fixed business negotiation
  // regardless of mode, so mock has no casual content to draw suggestedReplies
  // from. Real casual-mode replies only come from the Gemini provider.
  async analyze(
    lines: AnalysisInputLine[],
    _mode: SessionMode,
    context: AnalysisContext
  ): Promise<AnalysisResult> {
    void _mode;
    const isKnownDialogue = lines.every((l) => KNOWN_DIALOGUE.has(l.japanese));

    if (!isKnownDialogue) {
      return {
        title: {
          ja: "会議（分析にはGEMINI_API_KEYが必要です）",
          en: "Meeting (set GEMINI_API_KEY for real analysis)",
        },
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
      overview: {
        ja: "サプライヤーが新しい価格プランを顧客に説明した打ち合わせです。適用時期は顧客の予算事情を踏まえて再検討することになり、次回、具体的な数字をもとに再協議します。",
        en: "A supplier presented its new pricing plan to a customer. The start date will be reconsidered in light of the customer's budget, and both sides will meet again with concrete figures.",
      },
      keyPoints: [
        {
          headline: { ja: "新価格プランは来月から適用の予定。", en: "The new pricing plan is due to start next month." },
          detail: {
            ja: "ただし、この顧客については個別に検討する余地があるとサプライヤーが述べました。",
            en: "The supplier said it can look at this customer's case individually.",
          },
        },
        {
          headline: { ja: "顧客側は予算が厳しい。", en: "The customer's budget is tight." },
          detail: {
            ja: "予算上の制約を理由に、適用時期について柔軟な対応を求めました。",
            en: "The customer cited budget constraints and asked for flexibility on timing.",
          },
        },
        {
          headline: { ja: "次回、具体的な数字で再協議する。", en: "Both sides will reconvene with concrete figures." },
          detail: {
            ja: "サプライヤーには柔軟に対応できる部分があり、詳細は次回の打ち合わせで詰めます。",
            en: "The supplier has some room to be flexible; the details will be settled at the next meeting.",
          },
        },
      ],
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
          due: { ja: "次回打ち合わせまで", en: "Before the next meeting" },
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
          meaning: {
            ja: "製品やサービスの料金体系をまとめた案。",
            en: "A proposed structure of prices for a product or service.",
          },
        },
        {
          term: "御社",
          reading: "おんしゃ",
          translation: "your company",
          note: "Polite/formal way to refer to the listener's company in business Japanese.",
          meaning: {
            ja: "相手の会社を指す丁寧な言い方（話し言葉）。",
            en: "A polite spoken way of referring to the other party's company.",
          },
        },
      ],
      insights: sampleInsights(context),
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
