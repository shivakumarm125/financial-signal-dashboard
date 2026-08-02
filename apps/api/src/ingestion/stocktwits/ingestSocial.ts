import { prisma } from "@financial-adviser/shared";
import { fetchTickerMessages, scoreCredibility } from "./socialClient";

export interface SocialIngestResult {
  symbol: string;
  status: "ok" | "not_found" | "error";
  postsStored: number;
  bullish: number;
  bearish: number;
  error?: string;
}

/**
 * Ingests recent StockTwits messages for one ticker (B4).
 *
 * Deduped on StockTwits' own message id. Re-upserts rather than skipping, since
 * author reputation moves between runs and the credibility score derives from
 * it -- a post from an account that has since gained followers is genuinely
 * different data from what was first stored.
 */
export async function ingestSocialForTicker(symbol: string): Promise<SocialIngestResult> {
  const ticker = await prisma.ticker.upsert({
    where: { symbol: symbol.toUpperCase() },
    update: {},
    create: { symbol: symbol.toUpperCase() },
  });

  try {
    const posts = await fetchTickerMessages(symbol);

    let bullish = 0;
    let bearish = 0;

    for (const post of posts) {
      if (post.declaredSentiment === "Bullish") bullish++;
      if (post.declaredSentiment === "Bearish") bearish++;

      const { score, basis } = scoreCredibility(post);
      const data = {
        author: post.author,
        authorFollowers: post.authorFollowers,
        authorPostCount: post.authorPostCount,
        authorJoinedAt: post.authorJoinedAt,
        authorOfficial: post.authorOfficial,
        body: post.body,
        url: post.url,
        declaredSentiment: post.declaredSentiment,
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
        create: { tickerId: ticker.id, externalId: post.externalId, platform: "stocktwits", ...data },
      });
    }

    await prisma.socialIngestionState.upsert({
      where: { tickerId: ticker.id },
      update: { lastSyncedAt: new Date() },
      create: { tickerId: ticker.id, lastSyncedAt: new Date() },
    });

    return { symbol, status: "ok", postsStored: posts.length, bullish, bearish };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // An unlisted symbol is an expected outcome, not a broken integration.
    if (message.includes("404")) {
      return { symbol, status: "not_found", postsStored: 0, bullish: 0, bearish: 0, error: message };
    }
    return { symbol, status: "error", postsStored: 0, bullish: 0, bearish: 0, error: message };
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
