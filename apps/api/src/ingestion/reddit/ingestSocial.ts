import { prisma } from "@financial-adviser/shared";
import { searchTickerMentions, scoreCredibility } from "./socialClient";
import { REDDIT_CONFIGURED } from "./config";

export interface SocialIngestResult {
  symbol: string;
  status: "ok" | "not_configured" | "error";
  postsStored: number;
  error?: string;
}

/**
 * Ingests recent Reddit mentions for one ticker (B4).
 *
 * Dedupes on Reddit's own fullname (t3_xxx), like B3 does with Finnhub's
 * article id. Re-upserts existing posts rather than skipping them, because
 * score and comment count move after publication -- a two-day-old post's
 * engagement is genuinely different data from what it was at first sight, and
 * the credibility score derives from it.
 */
export async function ingestSocialForTicker(symbol: string): Promise<SocialIngestResult> {
  if (!REDDIT_CONFIGURED) {
    return { symbol, status: "not_configured", postsStored: 0 };
  }

  const ticker = await prisma.ticker.upsert({
    where: { symbol: symbol.toUpperCase() },
    update: {},
    create: { symbol: symbol.toUpperCase() },
  });

  try {
    const posts = await searchTickerMentions(symbol);

    for (const post of posts) {
      const { score, basis } = scoreCredibility(post);
      const data = {
        subreddit: post.subreddit,
        author: post.author,
        title: post.title,
        body: post.body,
        url: post.url,
        score: post.score,
        numComments: post.numComments,
        postedAt: post.postedAt,
        credibilityScore: score,
        credibilityBasis: basis,
        // Never anything but true -- A1/A3 require social content to be
        // structurally labelled unverified.
        isUnverified: true,
      };

      await prisma.socialPost.upsert({
        where: { tickerId_externalId: { tickerId: ticker.id, externalId: post.externalId } },
        update: data,
        create: { tickerId: ticker.id, externalId: post.externalId, platform: "reddit", ...data },
      });
    }

    await prisma.socialIngestionState.upsert({
      where: { tickerId: ticker.id },
      update: { lastSyncedAt: new Date() },
      create: { tickerId: ticker.id, lastSyncedAt: new Date() },
    });

    return { symbol, status: "ok", postsStored: posts.length };
  } catch (err) {
    return {
      symbol,
      status: "error",
      postsStored: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ingests social posts for a list of tickers. One ticker's failure doesn't stop the rest. */
export async function ingestSocial(symbols: string[]): Promise<SocialIngestResult[]> {
  const results: SocialIngestResult[] = [];
  for (const symbol of symbols) {
    results.push(await ingestSocialForTicker(symbol));
  }
  return results;
}
