import { MIN_REQUEST_INTERVAL_MS } from "./config";

let lastRequestAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function finnhubFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub request failed (${res.status} ${res.statusText}): ${url}`);
  }
  return res;
}
