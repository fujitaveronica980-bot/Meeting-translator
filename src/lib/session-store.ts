import type { Session } from "@/lib/types";
import { getDb, isFirestoreConfigured } from "@/lib/firebase-admin";

const COLLECTION = "sessions";
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
};
const memoryStore =
  globalForStore.__meetingTranslatorSessions ?? new Map<string, Session>();
globalForStore.__meetingTranslatorSessions = memoryStore;

export async function saveSession(session: Session): Promise<void> {
  if (isFirestoreConfigured()) {
    await getDb().collection(COLLECTION).doc(session.id).set(session);
    return;
  }
  memoryStore.set(session.id, session);
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
    return;
  }
  memoryStore.delete(id);
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
