import type { SttProvider, TranscribeOptions, TranscriptionResult, DiarizedSegment } from "./types";

/**
 * Speechmatics Batch Transcription API adapter.
 *
 * Docs: https://docs.speechmatics.com/speech-to-text/batch/quickstart
 * Free tier (2026): new accounts get $100 starting credit, no card required;
 * self-service accounts also get a recurring free-minutes allowance (check
 * your portal for the current figure, it has changed more than once).
 *
 * NOTE ON RESPONSE SHAPE: the request side below (endpoints, auth, multipart
 * fields) follows the documented Batch API v2 exactly. The transcript JSON
 * parsing is written against the documented "json-v2" export format, but you
 * should confirm it against a real response the first time you run this
 * (see scripts/spike-test.ts) since diarization label formatting can vary
 * slightly by account/model version.
 */

const REGION = process.env.SPEECHMATICS_REGION || "eu1";
const BASE_URL = `https://${REGION}.asr.api.speechmatics.com/v2`;

async function pollUntilDone(jobId: string, apiKey: string, timeoutMs = 10 * 60 * 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Speechmatics job status check failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const status = body?.job?.status;
    if (status === "done") return;
    if (status === "rejected") {
      throw new Error(`Speechmatics job rejected: ${JSON.stringify(body)}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Speechmatics job timed out waiting for transcription to complete");
}

function parseJsonV2Transcript(results: unknown[]): { segments: DiarizedSegment[]; durationMs: number } {
  const segments: DiarizedSegment[] = [];
  let currentSpeaker: string | null = null;
  let currentText = "";
  let currentStart = 0;
  let currentEnd = 0;
  let maxEnd = 0;

  const flush = () => {
    if (currentSpeaker !== null && currentText.trim()) {
      segments.push({
        speaker: currentSpeaker,
        startMs: Math.round(currentStart * 1000),
        endMs: Math.round(currentEnd * 1000),
        text: currentText.trim(),
      });
    }
    currentText = "";
  };

  for (const item of results as Array<{
    type: string;
    start_time?: number;
    end_time?: number;
    alternatives?: Array<{ content: string; speaker?: string }>;
  }>) {
    const alt = item.alternatives?.[0];
    if (!alt) continue;
    const speaker = alt.speaker || "S1";
    const end = item.end_time ?? currentEnd;
    maxEnd = Math.max(maxEnd, end);

    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
      currentStart = item.start_time ?? currentEnd;
    }
    currentEnd = end;

    if (item.type === "punctuation") {
      currentText += alt.content;
    } else {
      currentText += (currentText.endsWith(" ") || currentText === "" ? "" : "") + alt.content;
    }
  }
  flush();

  return { segments, durationMs: Math.round(maxEnd * 1000) };
}

export const speechmaticsProvider: SttProvider = {
  name: "speechmatics",
  freeTierMinutesPerMonth: 480,

  async transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscriptionResult> {
    const apiKey = process.env.SPEECHMATICS_API_KEY;
    if (!apiKey) {
      throw new Error("SPEECHMATICS_API_KEY is not set");
    }

    const config = {
      type: "transcription",
      transcription_config: {
        language: opts.language || "ja",
        diarization: "speaker",
        operating_point: "enhanced",
        speaker_diarization_config: {
          speaker_sensitivity: 0.5,
        },
      },
    };

    const form = new FormData();
    form.append("config", JSON.stringify(config));
    form.append(
      "data_file",
      new Blob([new Uint8Array(audio)], { type: opts.mimeType || "audio/webm" }),
      opts.filename || "audio.webm"
    );

    const createRes = await fetch(`${BASE_URL}/jobs/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!createRes.ok) {
      throw new Error(`Speechmatics job creation failed: ${createRes.status} ${await createRes.text()}`);
    }
    const { id: jobId } = await createRes.json();

    await pollUntilDone(jobId, apiKey);

    const transcriptRes = await fetch(`${BASE_URL}/jobs/${jobId}/transcript?format=json-v2`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!transcriptRes.ok) {
      throw new Error(`Speechmatics transcript fetch failed: ${transcriptRes.status} ${await transcriptRes.text()}`);
    }
    const transcriptJson = await transcriptRes.json();
    const { segments, durationMs } = parseJsonV2Transcript(transcriptJson.results || []);

    return {
      provider: "speechmatics",
      language: opts.language || "ja",
      durationMs,
      segments,
      raw: transcriptJson,
    };
  },
};
