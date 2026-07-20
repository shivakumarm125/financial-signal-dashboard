import { prisma } from "@financial-adviser/shared";
import { fetchCompanyNews } from "./newsClient";
import { BACKFILL_DAYS } from "./config";

export interface TickerNewsResult {
  symbol: string;
  status: "ok" | "error";
  articlesStored: number;
  error?: string;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ingests news for one ticker: first run backfills BACKFILL_DAYS (14 days,
 * Q2), later runs only request from the last-synced date to today. Dedup on
 * Finnhub's own article id via upsert -- safe against overlapping date ranges.
 */
export async function ingestNewsForTicker(symbol: string): Promise<TickerNewsResult> {
  const ticker = await prisma.ticker.upsert({
    where: { symbol: symbol.toUpperCase() },
    update: {},
    create: { symbol: symbol.toUpperCase() },
    include: { newsIngestionState: true },
  });

  try {
    const today = new Date();
    let fromDate: Date;
    if (ticker.newsIngestionState?.lastSyncedDate) {
      fromDate = new Date(ticker.newsIngestionState.lastSyncedDate);
    } else {
      fromDate = new Date();
      fromDate.setUTCDate(fromDate.getUTCDate() - BACKFILL_DAYS);
    }

    const articles = await fetchCompanyNews(symbol, formatDate(fromDate), formatDate(today));

    for (const article of articles) {
      await prisma.newsArticle.upsert({
        where: { tickerId_externalId: { tickerId: ticker.id, externalId: article.externalId } },
        update: {},
        create: {
          tickerId: ticker.id,
          externalId: article.externalId,
          source: article.source,
          headline: article.headline,
          summary: article.summary,
          url: article.url,
          publishedAt: article.publishedAt,
        },
      });
    }

    await prisma.newsIngestionState.upsert({
      where: { tickerId: ticker.id },
      update: { lastSyncedDate: today },
      create: { tickerId: ticker.id, lastSyncedDate: today },
    });

    return { symbol, status: "ok", articlesStored: articles.length };
  } catch (err) {
    return {
      symbol,
      status: "error",
      articlesStored: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function ingestNews(symbols: string[]): Promise<TickerNewsResult[]> {
  const results: TickerNewsResult[] = [];
  for (const symbol of symbols) {
    results.push(await ingestNewsForTicker(symbol));
  }
  return results;
}
