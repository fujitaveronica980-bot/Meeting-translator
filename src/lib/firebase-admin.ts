import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK singleton for server-side Firestore access.
 *
 * Needs a service account: Firebase Console -> Project Settings -> Service
 * Accounts -> Generate new private key. Set FIREBASE_PROJECT_ID,
 * FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY from that JSON file.
 * FIREBASE_PRIVATE_KEY is typically pasted with literal "\n" sequences
 * (most env var UIs, Render included, don't reliably preserve real
 * newlines in a single-line field) — unescaped below.
 */

export function isFirestoreConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
}

let app: App | null = null;

function getAdminApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
  return app;
}

export function getDb(): Firestore {
  return getFirestore(getAdminApp());
}
