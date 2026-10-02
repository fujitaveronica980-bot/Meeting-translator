/**
 * Keeps the server from being put to sleep while a recording is processing.
 *
 * Free hosting tiers (Render's included) spin a service down after ~15
 * minutes without an incoming request — and once the upload is in, nothing
 * else is guaranteed to call us: the page that polls for the result stops
 * the moment its phone's screen turns off. A long transcription would be
 * killed halfway. So while any job is running, the server requests its own
 * public URL every few minutes, which counts as traffic.
 *
 * Render sets RENDER_EXTERNAL_URL automatically; set KEEP_AWAKE_URL to the
 * app's public URL on any other host that sleeps. With neither set (e.g.
 * local dev, where nothing sleeps) this does nothing.
 */

const PING_INTERVAL_MS = 5 * 60 * 1000;

let activeJobs = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function ping(baseUrl: string) {
  // /login is outside the password gate, so this works with or without
  // APP_PASSWORD. The response doesn't matter — only that a request arrived.
  fetch(new URL("/login", baseUrl), { cache: "no-store" }).catch((err) =>
    console.error("Keep-awake ping failed:", err)
  );
}

export async function keepAwakeWhile<T>(
  work: () => Promise<T>,
  intervalMs = PING_INTERVAL_MS
): Promise<T> {
  const baseUrl = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) return work();

  activeJobs++;
  if (!timer) timer = setInterval(() => ping(baseUrl), intervalMs);
  try {
    return await work();
  } finally {
    activeJobs--;
    if (activeJobs === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
}
