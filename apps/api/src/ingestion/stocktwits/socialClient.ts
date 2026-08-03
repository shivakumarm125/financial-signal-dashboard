import { truncateSafely } from "@financial-adviser/shared";
import { stocktwitsFetch } from "./httpClient";
import { STOCKTWITS_BASE_URL, MAX_POSTS_PER_TICKER, SOCIAL_LOOKBACK_DAYS } from "./config";

export interface RawSocialPost {
  externalId: string;
  author: string | null;
  authorFollowers: number | null;
  authorPostCount: number | null;
  authorJoinedAt: Date | null;
  authorOfficial: boolean;
  body: string;
  url: string;
  declaredSentiment: string | null;
  postedAt: Date;
}

interface StocktwitsUser {
  id: number;
  username: string;
  followers?: number;
  ideas?: number;
  like_count?: number;
  join_date?: string;
  official?: boolean;
}

interface StocktwitsMessage {
  id: number;
  body: string;
  created_at: string;
  user?: StocktwitsUser;
  entities?: { sentiment?: { basic?: string } | null };
}

interface StreamResponse {
  messages?: StocktwitsMessage[];
}

/**
 * Fetches recent messages for one ticker's cashtag.
 *
 * Cashtag-native: StockTwits ties every message to the symbols it mentions, so
 * this is a lookup rather than a keyword search. That removes a whole class of
 * false positives Reddit would have produced -- searching "F" or "ALL" across
 * general forums returns mostly noise.
 */
export async function fetchTickerMessages(symbol: string): Promise<RawSocialPost[]> {
  const url = `${STOCKTWITS_BASE_URL}/streams/symbol/${encodeURIComponent(symbol.toUpperCase())}.json`;
  const res = await stocktwitsFetch(url);
  const data = (await res.json()) as StreamResponse;
  const messages = data.messages ?? [];

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - SOCIAL_LOOKBACK_DAYS);

  const posts: RawSocialPost[] = [];
  for (const m of messages.slice(0, MAX_POSTS_PER_TICKER)) {
    const postedAt = new Date(m.created_at);
    if (Number.isNaN(postedAt.getTime()) || postedAt < cutoff) continue;

    const user = m.user;
    const username = user?.username ?? null;

    posts.push({
      externalId: String(m.id),
      author: username,
      authorFollowers: user?.followers ?? null,
      authorPostCount: user?.ideas ?? null,
      authorJoinedAt: user?.join_date ? new Date(user.join_date + "T00:00:00.000Z") : null,
      authorOfficial: Boolean(user?.official),
      body: truncateSafely(m.body, 2000),
      url: username ? `https://stocktwits.com/${username}/message/${m.id}` : `https://stocktwits.com/message/${m.id}`,
      // Only present when the poster tagged their own message.
      declaredSentiment: m.entities?.sentiment?.basic ?? null,
      postedAt,
    });
  }

  return posts;
}

/**
 * B4's "source-credibility score", 0-100.
 *
 * IMPORTANT, and repeated in the prompt: this measures the AUTHOR'S STANDING on
 * the platform, not whether their claim is true. Nothing observable about a
 * post establishes accuracy. A widely-followed, long-established account can be
 * confidently wrong, and on a retail-trading forum frequently is.
 *
 * It is still a better score than the Reddit version this replaced. That one
 * could only see engagement on a single post -- upvotes measure how much
 * attention one message got, which says nothing about the person posting it.
 * StockTwits returns standing reputation inline: follower count, account age
 * and posting history, no extra API call required.
 *
 * Components, all deliberately shallow and inspectable:
 *   - followers, log-scaled so a 100k account doesn't swamp everything
 *   - account age, because a week-old account is a different proposition
 *   - post volume vs followers: very high output with few followers is the
 *     signature of a spam or bot account, and is penalised
 *   - an official/verified flag, where StockTwits sets one
 */
export function scoreCredibility(post: RawSocialPost): { score: number; basis: string } {
  const parts: string[] = [];

  const followers = post.authorFollowers ?? 0;
  const followerPoints = Math.min(45, Math.round(Math.log10(Math.max(1, followers)) * 15));
  parts.push(`${followerPoints} for ${followers} followers`);

  let agePoints = 0;
  if (post.authorJoinedAt) {
    const years = (Date.now() - post.authorJoinedAt.getTime()) / (365.25 * 24 * 3600 * 1000);
    agePoints = Math.min(20, Math.round(years * 4));
    parts.push(`${agePoints} for ${years.toFixed(1)}y account age`);
  } else {
    parts.push("0 for unknown account age");
  }

  const officialPoints = post.authorOfficial ? 15 : 0;
  if (officialPoints) parts.push(`${officialPoints} for official account`);

  // Spam signature: thousands of posts, almost nobody following.
  let penalty = 0;
  const posts = post.authorPostCount ?? 0;
  if (posts > 1000 && followers < posts / 20) {
    penalty = 15;
    parts.push(`-15 for ${posts} posts against only ${followers} followers (high-volume, low-following)`);
  }

  const total = Math.max(0, Math.min(100, followerPoints + agePoints + officialPoints - penalty));

  return {
    score: total,
    basis: `${parts.join(" + ").replace(/\+ -/g, "- ")} = ${total}/100 author standing (not accuracy)`,
  };
}
