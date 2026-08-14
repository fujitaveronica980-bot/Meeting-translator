import type { Session } from "@/lib/types";

/**
 * In-memory session store — zero cost, zero setup (no database account
 * needed to try the app). Sessions live only as long as the dev/prod server
 * process; a natural next step is to swap this for @supabase/supabase-js
 * (already a dependency) behind the same three functions once persistence
 * across restarts matters.
 *
 * Stored on globalThis so Next.js's dev-mode module reloading doesn't wipe
 * it on every hot reload.
 */

const globalForStore = globalThis as unknown as {
  __meetingTranslatorSessions?: Map<string, Session>;
};

const sessions =
  globalForStore.__meetingTranslatorSessions ?? new Map<string, Session>();
globalForStore.__meetingTranslatorSessions = sessions;

export function saveSession(session: Session): void {
  sessions.set(session.id, session);
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}
