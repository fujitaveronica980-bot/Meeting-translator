/**
 * Shared job polling for the async STT providers.
 *
 * Sized for long recordings: an hour-plus meeting can take a good while to
 * transcribe, so the overall wait is generous, and one failed status check
 * along the way (a network blip, a 5xx or 429 from the provider) is retried
 * instead of throwing away a job that is still running fine on their side.
 */

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 5;

/** A definite failure (job rejected, bad request) that retrying can't fix. */
export class PollFatalError extends Error {}

/**
 * Calls `check` every few seconds until it returns a value (job finished).
 * `check` returns undefined while the job is still running, and throws
 * PollFatalError for a definite failure.
 */
export async function pollUntilDone<T>(
  provider: string,
  check: () => Promise<T | undefined>
): Promise<T> {
  const start = Date.now();
  let failures = 0;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const result = await check();
      if (result !== undefined) return result;
      failures = 0;
    } catch (err) {
      if (err instanceof PollFatalError || ++failures >= MAX_CONSECUTIVE_FAILURES) throw err;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${provider} job timed out waiting for transcription to complete`);
}

/** A failed status response: 5xx/429 are worth retrying, anything else isn't. */
export function statusCheckError(provider: string, status: number, body: string): Error {
  const message = `${provider} job status check failed: ${status} ${body}`;
  return status >= 500 || status === 429 ? new Error(message) : new PollFatalError(message);
}
