const apiKey = process.env.TWELVE_DATA_API_KEY;
if (!apiKey) {
  throw new Error("TWELVE_DATA_API_KEY is not set.");
}

export const TWELVE_DATA_API_KEY = apiKey;

export const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com";

// Free tier: 8 requests/minute, 800/day. This is a hard, very tight budget --
// B2 is designed to spend exactly 1 request per ticker per sync (no separate
// indicator calls; see technicals.ts), and this interval keeps us safely under
// the per-minute cap even with some jitter.
export const MIN_REQUEST_INTERVAL_MS = 8_000;

// How far back to backfill the first time a ticker is added (Q2 decision):
// 1 year comfortably covers a 200-day moving average plus margin.
export const BACKFILL_DAYS = 365;
