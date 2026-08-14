import type { SttProvider, TranscribeOptions, TranscriptionResult } from "./types";

/**
 * Demo/dev provider used automatically when no STT API key is configured.
 * Lets the whole app run and be evaluated with zero signups.
 */
export const mockProvider: SttProvider = {
  name: "mock",
  freeTierMinutesPerMonth: Infinity,

  async transcribe(_audio: Buffer, opts: TranscribeOptions): Promise<TranscriptionResult> {
    const segments = [
      { speaker: "S1", startMs: 0, endMs: 4200, text: "本日はお時間をいただきありがとうございます。早速ですが、新しい価格プランについてご説明させていただきます。" },
      { speaker: "S2", startMs: 4400, endMs: 8100, text: "はい、よろしくお願いします。御社の新しいプランは来月から適用ということでよろしいでしょうか。" },
      { speaker: "S1", startMs: 8300, endMs: 13000, text: "そうですね、基本的には来月からを予定しておりますが、貴社の場合は少し検討させていただければと思います。" },
      { speaker: "S2", startMs: 13200, endMs: 17500, text: "承知しました。ただ、正直に申し上げますと、予算的には少し厳しい状況でして。" },
      { speaker: "S1", startMs: 17700, endMs: 22000, text: "なるほど、そのあたりは弊社としても柔軟に対応できる部分がございますので、また改めてご相談させてください。" },
      { speaker: "S2", startMs: 22200, endMs: 25000, text: "ありがとうございます。では次回、具体的な数字を持って再度お話しできればと思います。" },
    ];
    return {
      provider: "mock",
      language: opts.language || "ja",
      durationMs: 25000,
      segments,
    };
  },
};
