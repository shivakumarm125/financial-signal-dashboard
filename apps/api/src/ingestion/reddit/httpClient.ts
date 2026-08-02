import {
  REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET,
  REDDIT_TOKEN_URL,
  REDDIT_USER_AGENT,
  REDDIT_MIN_REQUEST_INTERVAL_MS,
} from "./config";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;

async function throttle() {
  const wait = REDDIT_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

/**
 * Application-only OAuth (client_credentials). No user context is needed --
 * this reads public posts, nothing more -- so there is no refresh token and no
 * user to act on behalf of.
 *
 * The token is cached until shortly before expiry. Reddit issues these with an
 * hour's life, and a fresh token per request would waste most of the rate
 * limit on authentication.
 */
async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  await throttle();
  const basic = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Reddit auth failed (${res.status}). ${
        res.status === 401
          ? "Check REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET -- for a 'script' app the ID is the short string under the app name, not the app name itself."
          : body.slice(0, 200)
      }`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: data.access_token,
    // 60s of headroom so a token can't expire mid-run.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cached.token;
}

/** Authenticated GET against oauth.reddit.com, throttled and with one retry on 429/5xx. */
export async function redditFetch(url: string, attempt = 0): Promise<Response> {
  const token = await getAccessToken();
  await throttle();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
  });

  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    // Respect Reddit's own backoff hint when it sends one.
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1));
    return redditFetch(url, attempt + 1);
  }

  if (res.status === 401) {
    // Token may have been revoked mid-run; drop it so the next call re-auths.
    cached = null;
  }

  if (!res.ok) {
    throw new Error(`Reddit request failed (${res.status}) for ${url}`);
  }

  return res;
}
