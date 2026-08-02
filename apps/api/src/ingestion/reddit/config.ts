const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;

/**
 * Reddit credentials are OPTIONAL, unlike every other provider.
 *
 * B4 is the fourth source and the pipeline has always run without it -- C1
 * reports missing social data as a genuine coverage gap rather than pretending
 * it isn't there. Throwing on startup would turn an absent nice-to-have into a
 * broken daily job, so absence is reported and the run continues.
 */
export const REDDIT_CONFIGURED = Boolean(clientId && clientSecret);

export const REDDIT_CLIENT_ID = clientId ?? "";
export const REDDIT_CLIENT_SECRET = clientSecret ?? "";

export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const REDDIT_API_BASE = "https://oauth.reddit.com";

// Reddit requires a descriptive, unique User-Agent and rate-limits generic ones
// hard. Format is platform:app-id:version (by /u/username).
export const REDDIT_USER_AGENT =
  process.env.REDDIT_USER_AGENT ?? "web:financial-signal-dashboard:0.1.0 (by /u/unknown)";

// A2/A3 name r/wallstreetbets and r/stocks; r/investing is included as the more
// measured end of the spectrum so the mix isn't purely speculative.
export const SUBREDDITS = ["stocks", "wallstreetbets", "investing"];

// OAuth clients get 100 requests/minute. One search call per ticker per run is
// far inside that, but the delay keeps us honest if that ever changes.
export const REDDIT_MIN_REQUEST_INTERVAL_MS = 700;

// A5 only ever shows Claude the most recent N items, so deep history has no use
// (same reasoning as B3's news window).
export const SOCIAL_LOOKBACK_DAYS = 14;
export const MAX_POSTS_PER_TICKER = 50;
