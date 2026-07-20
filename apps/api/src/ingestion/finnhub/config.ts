const apiKey = process.env.FINNHUB_API_KEY;
if (!apiKey) {
  throw new Error("FINNHUB_API_KEY is not set.");
}

export const FINNHUB_API_KEY = apiKey;
export const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

// Free tier: 60 requests/minute. Generous relative to Twelve Data, but still
// throttled -- 1.1s between calls stays safely under the cap.
export const MIN_REQUEST_INTERVAL_MS = 1_100;

// News is perishable and A5 only ever shows Claude the most recent 10 items
// (Q21) -- unlike price/filings, there's no use case for deep historical
// backfill here, so this window is deliberately short (Q2, B3 grill).
export const BACKFILL_DAYS = 14;
