import { MIN_REQUEST_INTERVAL_MS } from "./config";

let lastRequestAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Throttled fetch for Twelve Data: serializes requests to stay well under the
 * free tier's 8 req/minute cap. Every call here costs real, scarce quota
 * (800/day total) -- callers should make exactly one call per ticker per sync,
 * never retry-in-a-loop speculatively.
 */
export async function twelveDataFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Twelve Data request failed (${res.status} ${res.statusText}): ${url}`);
  }
  return res;
}
