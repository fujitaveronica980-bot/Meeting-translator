import type { SttProvider } from "./types";
import { speechmaticsProvider } from "./speechmatics";
import { amivoiceProvider } from "./amivoice";
import { mockProvider } from "./mock";

export type { SttProvider, TranscribeOptions, TranscriptionResult, DiarizedSegment } from "./types";

/**
 * Provider is selected via the STT_PROVIDER env var so the rest of the app
 * never hard-codes a vendor. This is the "thin adapter layer" called out in
 * the plan so a provider swap doesn't require touching the pipeline code.
 */
export function getSttProvider(): SttProvider {
  const provider = (process.env.STT_PROVIDER || "").toLowerCase();

  if (provider === "speechmatics") return speechmaticsProvider;
  if (provider === "amivoice") return amivoiceProvider;
  if (provider === "mock") return mockProvider;

  if (process.env.SPEECHMATICS_API_KEY) return speechmaticsProvider;
  if (process.env.AMIVOICE_API_KEY) return amivoiceProvider;

  return mockProvider;
}
