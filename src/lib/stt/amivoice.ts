import type { SttProvider, TranscribeOptions, TranscriptionResult, DiarizedSegment } from "./types";

/**
 * AmiVoice Cloud Platform - Asynchronous HTTP API adapter.
 *
 * Docs: https://docs.amivoice.com/en/amivoice-api/manual/async-http-interface
 * Free tier (2026): 60 minutes/month free per engine, no card required for
 * the free allotment.
 *
 * NOTE ON RESPONSE SHAPE: request side (endpoint, auth header, multipart
 * fields, diarization params) follows the documented Async HTTP interface.
 * The exact field names for per-utterance speaker labels in the result
 * payload should be confirmed against a live response the first time you
 * run this (see scripts/spike-test.ts) - AmiVoice's docs describe the
 * request contract clearly but the utterance-level result schema is best
 * verified empirically.
 */

const BASE_URL = "https://acp-api-async.amivoice.com/v2/recognitions";

interface AmiVoiceUtterance {
  text?: string;
  speaker?: string | number;
  startTime?: number;
  endTime?: number;
}

interface AmiVoiceResult {
  status: string;
  text?: string;
  utterances?: AmiVoiceUtterance[];
  segments?: AmiVoiceUtterance[];
}

async function pollUntilDone(sessionId: string, apiKey: string, timeoutMs = 20 * 60 * 1000): Promise<AmiVoiceResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}/${sessionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`AmiVoice status check failed: ${res.status} ${await res.text()}`);
    }
    const body: AmiVoiceResult = await res.json();
    if (body.status === "completed" || body.status === "done") return body;
    if (body.status === "error" || body.status === "failed") {
      throw new Error(`AmiVoice job failed: ${JSON.stringify(body)}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("AmiVoice job timed out waiting for transcription to complete");
}

export const amivoiceProvider: SttProvider = {
  name: "amivoice",
  freeTierMinutesPerMonth: 60,

  async transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscriptionResult> {
    const apiKey = process.env.AMIVOICE_API_KEY;
    if (!apiKey) {
      throw new Error("AMIVOICE_API_KEY is not set");
    }

    const minSpeakers = opts.minSpeakers ?? 1;
    const maxSpeakers = opts.maxSpeakers ?? 6;
    const dParam = [
      "grammarFileNames=-a-general",
      "speakerDiarization=True",
      `diarizationMinSpeaker=${minSpeakers}`,
      `diarizationMaxSpeaker=${maxSpeakers}`,
      "loggingOptOut=True",
    ].join(" ");

    const form = new FormData();
    form.append("d", dParam);
    form.append(
      "a",
      new Blob([new Uint8Array(audio)], { type: opts.mimeType || "audio/wav" }),
      opts.filename || "audio.wav"
    );

    const createRes = await fetch(BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!createRes.ok) {
      throw new Error(`AmiVoice job creation failed: ${createRes.status} ${await createRes.text()}`);
    }
    const created = await createRes.json();
    const sessionId = created.sessionid || created.session_id || created.id;
    if (!sessionId) {
      throw new Error(`AmiVoice job creation response missing session id: ${JSON.stringify(created)}`);
    }

    const result = await pollUntilDone(sessionId, apiKey);

    const utterances = result.utterances || result.segments || [];
    let segments: DiarizedSegment[];
    let durationMs = 0;

    if (utterances.length > 0) {
      segments = utterances.map((u) => {
        const endMs = Math.round((u.endTime ?? 0));
        durationMs = Math.max(durationMs, endMs);
        return {
          speaker: `S${u.speaker ?? "1"}`,
          startMs: Math.round(u.startTime ?? 0),
          endMs,
          text: (u.text || "").trim(),
        };
      });
    } else {
      segments = [{ speaker: "S1", startMs: 0, endMs: 0, text: (result.text || "").trim() }];
    }

    return {
      provider: "amivoice",
      language: opts.language || "ja",
      durationMs,
      segments,
      raw: result,
    };
  },
};
