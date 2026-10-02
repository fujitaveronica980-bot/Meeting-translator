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
  /**
   * `audio` is the uploaded file as-is (a Blob), not a Buffer — it goes
   * straight into the provider's multipart request, so a long recording
   * isn't copied several times over in memory on the way.
   */
  transcribe(
    audio: Blob,
    opts: TranscribeOptions
  ): Promise<TranscriptionResult>;
}
