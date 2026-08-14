"use client";

import { useCallback, useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "error";

export interface AudioRecorderState {
  status: RecorderStatus;
  elapsedSec: number;
  /** 0-1 mic input level, for a simple "is it actually picking up sound" meter. */
  level: number;
  error: string | null;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Records microphone audio entirely in the browser (MediaRecorder). On stop,
 * hands the assembled recording to `onStop` as a File — from there it goes
 * through the exact same /api/sessions pipeline as an uploaded file.
 *
 * No live transcription while recording: this just captures the whole
 * session locally, then processes it once you hit stop.
 */
export function useAudioRecorder(onStop: (file: File) => void) {
  const [state, setState] = useState<AudioRecorderState>({
    status: "idle",
    elapsedSec: 0,
    level: 0,
    error: null,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    timerRef.current = null;
    levelTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setState({ status: "idle", elapsedSec: 0, level: 0, error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        const ext = mimeType?.includes("mp4") ? "m4a" : mimeType?.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `recording.${ext}`, { type: blob.type });
        cleanup();
        setState((s) => ({ ...s, status: "idle", level: 0 }));
        onStop(file);
      };
      recorder.start();

      // Level meter: simple RMS of the time-domain signal, sampled a few times a second.
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      levelTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / data.length);
        setState((s) => ({ ...s, level: Math.min(1, rms * 4) }));
      }, 100);

      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, elapsedSec: s.elapsedSec + 1 }));
      }, 1000);

      setState((s) => ({ ...s, status: "recording" }));
    } catch (err) {
      cleanup();
      setState({
        status: "error",
        elapsedSec: 0,
        level: 0,
        error:
          err instanceof Error
            ? err.message
            : "Could not access the microphone.",
      });
    }
  }, [cleanup, onStop]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  return { ...state, start, stop };
}
