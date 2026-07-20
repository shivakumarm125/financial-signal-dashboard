import { finnhubFetch } from "./httpClient";
import { FINNHUB_API_KEY, FINNHUB_BASE_URL } from "./config";

export interface RawArticle {
  externalId: string;
  source: string;
  headline: string;
  summary: string | null;
  url: string;
  publishedAt: Date;
}

interface FinnhubArticle {
  id: number;
  source: string;
  headline: string;
  summary: string;
  url: string;
  datetime: number; // unix seconds
}

/**
 * Fetches company-specific news for one symbol between `from` and `to`
 * (both "YYYY-MM-DD"). Finnhub's /company-news endpoint, not the general
 * /news market feed -- we need articles tied to a specific ticker.
 */
export async function fetchCompanyNews(symbol: string, from: string, to: string): Promise<RawArticle[]> {
  const url =
    `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(symbol)}` +
    `&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;

  const res = await finnhubFetch(url);
  const data = (await res.json()) as FinnhubArticle[];

  return data.map((a) => ({
    externalId: String(a.id),
    source: a.source,
    headline: a.headline,
    summary: a.summary?.trim() ? a.summary.trim() : null,
    url: a.url,
    publishedAt: new Date(a.datetime * 1000),
  }));
}
