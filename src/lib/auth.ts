/**
 * Shared-password access gate for the whole app. Protects /api/sessions too
 * (not just the page) — that's the endpoint that actually spends real money
 * on Speechmatics/Gemini calls, so it needs to be behind the gate, not just
 * the UI.
 *
 * Disabled entirely (everything public, current behavior) when APP_PASSWORD
 * isn't set — matches the rest of the app's "works with zero config"
 * philosophy. Set APP_PASSWORD in the deployment's env vars to turn it on.
 */

export const AUTH_COOKIE_NAME = "app_auth";

export function isGateEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/**
 * The cookie stores a hash of the password rather than the password itself,
 * so it isn't sitting in plaintext in the browser's cookie storage.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedAuthCookieValue(): Promise<string | null> {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  return sha256Hex(password);
}
