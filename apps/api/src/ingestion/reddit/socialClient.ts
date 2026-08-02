import { redditFetch } from "./httpClient";
import { REDDIT_API_BASE, SUBREDDITS, MAX_POSTS_PER_TICKER, SOCIAL_LOOKBACK_DAYS } from "./config";

export interface RawSocialPost {
  externalId: string;
  subreddit: string;
  author: string | null;
  title: string;
  body: string | null;
  url: string;
  score: number;
  numComments: number;
  postedAt: Date;
}

interface RedditChild {
  kind: string;
  data: {
    name: string;
    subreddit: string;
    author?: string;
    title: string;
    selftext?: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    over_18?: boolean;
    stickied?: boolean;
  };
}

interface RedditListing {
  data?: { children?: RedditChild[] };
}

/**
 * Searches the configured subreddits for mentions of one ticker.
 *
 * Searches a combined multireddit in a single request rather than one call per
 * subreddit -- three times fewer requests, and Reddit sorts the merged result
 * itself.
 *
 * Deliberately a plain symbol search, with no attempt to filter for "quality".
 * The point of this source is what the forum is actually saying, and silently
 * dropping posts the pipeline judged unserious would misrepresent the very
 * sentiment it exists to capture. Ranking is left to the credibility score,
 * where it is visible.
 */
export async function searchTickerMentions(symbol: string): Promise<RawSocialPost[]> {
  const query = encodeURIComponent(`${symbol}`);
  const subs = SUBREDDITS.join("+");
  const url =
    `${REDDIT_API_BASE}/r/${subs}/search?q=${query}` +
    `&restrict_sr=1&sort=new&limit=${MAX_POSTS_PER_TICKER}&t=month&type=link`;

  const res = await redditFetch(url);
  const data = (await res.json()) as RedditListing;
  const children = data.data?.children ?? [];

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - SOCIAL_LOOKBACK_DAYS);

  const posts: RawSocialPost[] = [];
  for (const child of children) {
    if (child.kind !== "t3") continue; // links/self-posts only, not comments
    const d = child.data;
    if (d.stickied) continue; // pinned mod posts aren't sentiment
    if (d.over_18) continue;

    const postedAt = new Date(d.created_utc * 1000);
    if (postedAt < cutoff) continue;

    posts.push({
      externalId: d.name,
      subreddit: d.subreddit,
      author: d.author && d.author !== "[deleted]" ? d.author : null,
      title: d.title,
      body: d.selftext && d.selftext.length > 0 ? d.selftext.slice(0, 2000) : null,
      url: `https://www.reddit.com${d.permalink}`,
      score: d.score,
      numComments: d.num_comments,
      postedAt,
    });
  }

  return posts;
}

/**
 * B4's "source-credibility score", 0-100.
 *
 * IMPORTANT, and stated in the prompt too: this measures PROMINENCE, not
 * truth. Nothing observable about a Reddit post establishes whether its claim
 * is correct. What can be observed is which forum it appeared in and how much
 * traction it got, and those are weak proxies for how seriously a reader might
 * treat it -- not evidence that it is right. A heavily upvoted post can be
 * confidently wrong, and frequently is.
 *
 * Components:
 *   - forum baseline: r/investing and r/stocks skew more measured than
 *     r/wallstreetbets, which is explicitly speculative by its own description.
 *   - engagement: score and comment count, log-scaled so one viral post doesn't
 *     dominate a whole ticker's sentiment.
 *
 * Author account age and karma would be the genuinely useful signals here, but
 * each costs an extra API call per unique author. Documented limitation, not an
 * oversight.
 */
const SUBREDDIT_BASELINE: Record<string, number> = {
  investing: 45,
  stocks: 40,
  wallstreetbets: 20,
};

export function scoreCredibility(post: RawSocialPost): { score: number; basis: string } {
  const sub = post.subreddit.toLowerCase();
  const baseline = SUBREDDIT_BASELINE[sub] ?? 30;

  // log10 scaling: 10 upvotes -> ~10pts, 100 -> ~20, 1000 -> ~30, capped at 35.
  const scorePoints = Math.min(35, Math.max(0, Math.round(Math.log10(Math.max(1, post.score)) * 10)));
  const commentPoints = Math.min(20, Math.max(0, Math.round(Math.log10(Math.max(1, post.numComments)) * 8)));

  const total = Math.min(100, baseline + scorePoints + commentPoints);

  return {
    score: total,
    basis:
      `r/${post.subreddit} baseline ${baseline}` +
      ` + ${scorePoints} for ${post.score} upvotes` +
      ` + ${commentPoints} for ${post.numComments} comments` +
      ` = ${total}/100 prominence (not accuracy)`,
  };
}
