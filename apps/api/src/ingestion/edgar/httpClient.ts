import { EDGAR_USER_AGENT, MIN_REQUEST_INTERVAL_MS } from "./config";

let lastRequestAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper shared by every EDGAR call: enforces the required User-Agent,
 * serializes requests to stay under SEC's 10 req/sec limit, and retries once
 * on a 429 with a short backoff before giving up.
 */
export async function edgarFetch(url: string, attempt = 0): Promise<Response> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetch(url, {
    headers: {
      "User-Agent": EDGAR_USER_AGENT,
      "Accept-Encoding": "gzip, deflate",
    },
  });

  if (res.status === 429 && attempt < 2) {
    await sleep(1000 * (attempt + 1));
    return edgarFetch(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`EDGAR request failed (${res.status} ${res.statusText}): ${url}`);
  }

  return res;
}
