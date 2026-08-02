import { STOCKTWITS_MIN_REQUEST_INTERVAL_MS, STOCKTWITS_USER_AGENT } from "./config";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;

/**
 * Throttled GET against the StockTwits public API, with one retry on 429/5xx.
 *
 * No auth header: the streams endpoint is public. A 429 here means the
 * anonymous hourly allowance is spent, which is worth backing off from rather
 * than hammering -- that allowance is the only thing standing between this and
 * needing a registered app, which is exactly what went wrong with Reddit.
 */
export async function stocktwitsFetch(url: string, attempt = 0): Promise<Response> {
  const wait = STOCKTWITS_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { "User-Agent": STOCKTWITS_USER_AGENT, Accept: "application/json" } });

  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1));
    return stocktwitsFetch(url, attempt + 1);
  }

  if (!res.ok) {
    // 404 means the symbol isn't on StockTwits -- a real, expected outcome for
    // obscure tickers, and worth distinguishing from a broken integration.
    throw new Error(
      res.status === 404
        ? `Symbol not found on StockTwits (404) for ${url}`
        : `StockTwits request failed (${res.status}) for ${url}`
    );
  }

  return res;
}
