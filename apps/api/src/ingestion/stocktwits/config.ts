export const STOCKTWITS_BASE_URL = "https://api.stocktwits.com/api/2";

/**
 * StockTwits' public streams endpoint needs no key and no app registration.
 *
 * That is why it replaced Reddit here: A2 picked Reddit and flagged its terms
 * as tightening, and on 2026-08-02 that risk landed -- app creation is gated
 * behind a Responsible Builder Policy review, so there is no self-serve path to
 * credentials. This endpoint is reachable today, and being cashtag-native it
 * also avoids the keyword-search noise Reddit would have brought.
 *
 * Used on the same tracked non-commercial-use assumption A3 records: a small,
 * free, invite-only tool. Not formally legally verified.
 */
export const STOCKTWITS_CONFIGURED = true;

// No rate-limit headers are exposed, and the documented ceiling for anonymous
// access has historically been in the low hundreds per hour. One call per
// ticker per run is nowhere near it, but the delay keeps a burst of tickers
// from looking like abuse.
export const STOCKTWITS_MIN_REQUEST_INTERVAL_MS = 1500;

// A5 only ever shows Claude the most recent N items, so deep history has no use
// (same reasoning as B3's news window).
export const SOCIAL_LOOKBACK_DAYS = 14;

// The endpoint returns ~30 per call; there is no reason to page for more when
// the prompt shows 10.
export const MAX_POSTS_PER_TICKER = 30;

export const STOCKTWITS_USER_AGENT =
  process.env.STOCKTWITS_USER_AGENT ?? "financial-signal-dashboard/0.1 (research dashboard)";
