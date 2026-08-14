export interface DiarizedSegment {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  provider: string;
  language: string;
  durationMs: number;
  segments: DiarizedSegment[];
  raw?: unknown;
}

export interface TranscribeOptions {
  language?: string;
  minSpeakers?: number;
  maxSpeakers?: number;
  filename?: string;
  mimeType?: string;
}

export interface SttProvider {
  name: string;
  /** Free-tier monthly minute cap this provider publishes, for quota warnings. */
  freeTierMinutesPerMonth: number;
  transcribe(
    audio: Buffer,
    opts: TranscribeOptions
  ): Promise<TranscriptionResult>;
}
