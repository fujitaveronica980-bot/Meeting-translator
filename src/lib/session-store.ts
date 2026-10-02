import type { Session } from "@/lib/types";
import type { DiarizedSegment } from "@/lib/stt";
import { getDb, isFirestoreConfigured } from "@/lib/firebase-admin";

const COLLECTION = "sessions";
// Transcripts live apart from their session: a session is loaded on every
// page view and status check, and an hour of transcript would ride along
// each time — and count toward the session document's size limit.
const TRANSCRIPTS = "transcripts";
// Firestore caps a document at 1 MiB; leave headroom rather than fail a save.
const MAX_TRANSCRIPT_CHARS = 900_000;

export interface StoredTranscript {
  segments: DiarizedSegment[];
  durationMs: number;
  /** From the "Try sample recording" button — re-analysis must stay on the mock provider. */
  sample: boolean;
}
// Bounds Firestore read cost/latency as history grows over time, rather
// than fetching every session ever made on every page load.
const LIST_LIMIT = 50;

/**
 * Session persistence. Backed by Firestore when configured (survives
 * restarts/redeploys, syncs across devices); falls back to an in-memory Map
 * otherwise, matching every other feature's "works with zero config"
 * default — no database account needed to just try the app.
 *
 * In-memory store is kept on globalThis so Next.js's dev-mode module
 * reloading doesn't wipe it on every hot reload.
 */

const globalForStore = globalThis as unknown as {
  __meetingTranslatorSessions?: Map<string, Session>;
  __meetingTranslatorTranscripts?: Map<string, StoredTranscript>;
};
const memoryStore =
  globalForStore.__meetingTranslatorSessions ?? new Map<string, Session>();
globalForStore.__meetingTranslatorSessions = memoryStore;
const memoryTranscripts =
  globalForStore.__meetingTranslatorTranscripts ?? new Map<string, StoredTranscript>();
globalForStore.__meetingTranslatorTranscripts = memoryTranscripts;

export async function saveTranscript(id: string, transcript: StoredTranscript): Promise<void> {
  if (isFirestoreConfigured()) {
    if (JSON.stringify(transcript).length > MAX_TRANSCRIPT_CHARS) {
      throw new Error("Transcript is too large to store");
    }
    await getDb().collection(TRANSCRIPTS).doc(id).set(transcript);
    return;
  }
  memoryTranscripts.set(id, transcript);
}

export async function getTranscript(id: string): Promise<StoredTranscript | undefined> {
  if (isFirestoreConfigured()) {
    const doc = await getDb().collection(TRANSCRIPTS).doc(id).get();
    return doc.exists ? (doc.data() as StoredTranscript) : undefined;
  }
  return memoryTranscripts.get(id);
}

export async function saveSession(session: Session): Promise<void> {
  if (isFirestoreConfigured()) {
    await getDb().collection(COLLECTION).doc(session.id).set(session);
    return;
  }
  memoryStore.set(session.id, session);
}

/**
 * Updates only the heartbeat field, never the whole document — it runs on a
 * timer alongside the pipeline's own saves, and a full overwrite landing
 * late could put a finished session back to "transcribing".
 */
export async function touchSession(id: string, heartbeatAt: string): Promise<void> {
  if (isFirestoreConfigured()) {
    await getDb().collection(COLLECTION).doc(id).update({ heartbeatAt });
    return;
  }
  const session = memoryStore.get(id);
  if (session) session.heartbeatAt = heartbeatAt;
}

/** Field-only for the same reason as touchSession: never rewrite a session from a stale copy. */
export async function setDoneActions(id: string, doneActions: number[]): Promise<void> {
  if (isFirestoreConfigured()) {
    await getDb().collection(COLLECTION).doc(id).update({ doneActions });
    return;
  }
  const session = memoryStore.get(id);
  if (session) session.doneActions = doneActions;
}

export async function getSession(id: string): Promise<Session | undefined> {
  if (isFirestoreConfigured()) {
    const doc = await getDb().collection(COLLECTION).doc(id).get();
    return doc.exists ? (doc.data() as Session) : undefined;
  }
  return memoryStore.get(id);
}

export async function deleteSession(id: string): Promise<void> {
  if (isFirestoreConfigured()) {
    await getDb().collection(COLLECTION).doc(id).delete();
    await getDb().collection(TRANSCRIPTS).doc(id).delete();
    return;
  }
  memoryStore.delete(id);
  memoryTranscripts.delete(id);
}

export async function listSessions(): Promise<Session[]> {
  if (isFirestoreConfigured()) {
    const snapshot = await getDb()
      .collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(LIST_LIMIT)
      .get();
    return snapshot.docs.map((d) => d.data() as Session);
  }
  return Array.from(memoryStore.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
