import { prisma } from "@financial-adviser/shared";
import { getStoredTechnicals } from "../ingestion/twelvedata/ingestPrices";
import { Technicals } from "../ingestion/twelvedata/technicals";

// A5 prompt-bounding defaults (most-recent-N per source, Q21).
const INSIDER_LOOKBACK_DAYS = 90;
const MAX_INSIDER_FILINGS = 10;
const MAX_NEWS_ITEMS = 10;

export interface CitationRecord {
  type: "filing" | "news";
  recordId: string; // the real DB row id, resolved from the short prompt-scoped id below
}

export interface SourceCoverage {
  filings: boolean;
  price: boolean;
  news: boolean;
  social: boolean; // B4 not built yet -- always false for now, not a placeholder integration
}

export type PreTagDirection = "bullish" | "bearish" | "neutral";

export interface PreTagDirections {
  insider: PreTagDirection; // from net buy/sell shares; neutral when no filings or net is exactly 0
  price: PreTagDirection; // from 50/200-day MA position; neutral when they disagree or data's missing
}

export interface AssembledContext {
  tickerId: string;
  tickerSymbol: string;
  promptText: string;
  citationMap: Record<string, CitationRecord>; // short id (e.g. "filing_0") -> real record, built fresh per assembly (Q1)
  sourceCoverage: SourceCoverage;
  preTagDirections: PreTagDirections; // feeds C3's confidence-capping rule (A5 Q15)
  currentPrice: number | null; // feeds C3's entry/target/stop-loss sanity check (added 2026-07-19)
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function insiderRoleLabel(f: { insiderIsOfficer: boolean; insiderOfficerTitle: string | null; insiderIsDirector: boolean; insiderIsTenPercentOwner: boolean }): string {
  if (f.insiderIsOfficer) return f.insiderOfficerTitle ?? "Officer";
  if (f.insiderIsDirector) return "Director";
  if (f.insiderIsTenPercentOwner) return "10% Owner";
  return "Insider";
}

/**
 * Assembles the structured, size-bounded prompt A5 specifies, from whatever
 * of the 3 built sources (B1 filings, B2 price/technicals, B3 news) have
 * data for this ticker. Social (B4) isn't built yet -- reported as no
 * coverage per A5's Q20 rule, not a placeholder integration point built
 * ahead of the source actually existing.
 */
export async function assembleContextForTicker(symbol: string): Promise<AssembledContext> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!ticker) {
    throw new Error(`Ticker ${symbol} not found -- must be ingested (B1/B2/B3) before assembling a prompt.`);
  }

  const citationMap: Record<string, CitationRecord> = {};

  // --- Insider filings: pre-tagged (A5 hybrid design) ---
  const filings = await prisma.insiderFiling.findMany({
    where: { tickerId: ticker.id, transactionDate: { gte: daysAgo(INSIDER_LOOKBACK_DAYS) } },
    orderBy: { transactionDate: "desc" },
    take: MAX_INSIDER_FILINGS,
  });

  const buys = filings.filter((f) => f.transactionCode === "P");
  const sells = filings.filter((f) => f.transactionCode === "S");
  const netShares =
    buys.reduce((sum, f) => sum + Number(f.sharesTransacted), 0) -
    sells.reduce((sum, f) => sum + Number(f.sharesTransacted), 0);

  const filingLines = filings.map((f, i) => {
    const id = `filing_${i}`;
    citationMap[id] = { type: "filing", recordId: f.id };
    const price = f.pricePerShare ? ` @ $${Number(f.pricePerShare).toFixed(2)}` : "";
    return `  [${id}] ${f.transactionDate.toISOString().slice(0, 10)} | ${f.insiderName} (${insiderRoleLabel(f)}) | code=${f.transactionCode} | ${Number(f.sharesTransacted).toLocaleString()} shares${price}`;
  });

  // --- Price/technicals: pre-tagged (A5), a single summary, not individually citable ---
  const technicals = await getStoredTechnicals(ticker.id);
  const hasPriceData = technicals.ma50 !== null || technicals.ma200 !== null;

  // --- News: raw (A5) -- no sentiment pre-tagging, individually citable ---
  const news = await prisma.newsArticle.findMany({
    where: { tickerId: ticker.id },
    orderBy: { publishedAt: "desc" },
    take: MAX_NEWS_ITEMS,
  });

  const newsLines = news.map((n, i) => {
    const id = `news_${i}`;
    citationMap[id] = { type: "news", recordId: n.id };
    const summary = n.summary ? ` — ${n.summary}` : "";
    return `  [${id}] ${n.publishedAt.toISOString().slice(0, 10)} | ${n.source} | ${n.headline}${summary}`;
  });

  const sourceCoverage: SourceCoverage = {
    filings: filings.length > 0,
    price: hasPriceData,
    news: news.length > 0,
    social: false,
  };

  const preTagDirections: PreTagDirections = {
    insider: netShares > 0 ? "bullish" : netShares < 0 ? "bearish" : "neutral",
    price:
      technicals.priceAboveMa50 === true && technicals.priceAboveMa200 === true
        ? "bullish"
        : technicals.priceAboveMa50 === false && technicals.priceAboveMa200 === false
          ? "bearish"
          : "neutral",
  };

  const promptText = buildPromptText({
    symbol: ticker.symbol,
    name: ticker.name,
    buysCount: buys.length,
    sellsCount: sells.length,
    netShares,
    filingLines,
    technicals,
    hasPriceData,
    newsLines,
    sourceCoverage,
  });

  return {
    tickerId: ticker.id,
    tickerSymbol: ticker.symbol,
    promptText,
    citationMap,
    sourceCoverage,
    preTagDirections,
    currentPrice: technicals.latestClose,
  };
}

function formatTechnicals(t: Technicals, hasPriceData: boolean): string {
  if (!hasPriceData) return "  No price/technicals data available.";
  const lines: string[] = [];
  if (t.latestClose !== null) {
    lines.push(`  Current price: $${t.latestClose.toFixed(2)}.`);
  }
  if (t.recentHigh20d !== null && t.recentLow20d !== null) {
    lines.push(`  Recent 20-day trading range: $${t.recentLow20d.toFixed(2)} - $${t.recentHigh20d.toFixed(2)}.`);
  }
  if (t.ma50 !== null) {
    lines.push(`  Price is ${t.priceAboveMa50 ? "above" : "below"} its 50-day moving average ($${t.ma50.toFixed(2)}).`);
  }
  if (t.ma200 !== null) {
    lines.push(`  Price is ${t.priceAboveMa200 ? "above" : "below"} its 200-day moving average ($${t.ma200.toFixed(2)}).`);
  }
  lines.push(`  Volume trend: ${t.volumeTrend} (10-day avg vs. 90-day avg volume).`);
  return lines.join("\n");
}

function buildPromptText(input: {
  symbol: string;
  name: string | null;
  buysCount: number;
  sellsCount: number;
  netShares: number;
  filingLines: string[];
  technicals: Technicals;
  hasPriceData: boolean;
  newsLines: string[];
  sourceCoverage: SourceCoverage;
}): string {
  const missingSources: string[] = [];
  if (!input.sourceCoverage.filings) missingSources.push("insider filings");
  if (!input.sourceCoverage.price) missingSources.push("price/technicals");
  if (!input.sourceCoverage.news) missingSources.push("news");
  missingSources.push("social/forum sentiment (not yet integrated)");

  const coverageNote =
    missingSources.length > 0
      ? `Note: no data was available this run for: ${missingSources.join(", ")}. Your rationale must explicitly acknowledge this.`
      : "All source types had data this run.";

  return `You are generating a research signal for ${input.symbol}${input.name ? ` (${input.name})` : ""}. This is a research tool, not financial advice -- your output will be labeled "signal", never "prediction".

## Source reliability guidance
- Insider filings are concrete, public-record-backed facts (SEC Form 4).
- Price/technicals are concrete, objective market data.
- News should be read for genuine sentiment/nuance -- do not apply a crude keyword-based reading.
- (Social/forum sentiment is not yet part of this pipeline.)

## Insider filings (last ${INSIDER_LOOKBACK_DAYS} days, pre-tagged)
Net activity: ${input.buysCount} buy(s), ${input.sellsCount} sale(s), net ${input.netShares >= 0 ? "+" : ""}${input.netShares.toLocaleString()} shares.
${input.filingLines.length > 0 ? input.filingLines.join("\n") : "  No insider filings in this window."}

## Price/technicals (pre-tagged)
${formatTechnicals(input.technicals, input.hasPriceData)}

## Recent news (raw, read for genuine sentiment)
${input.newsLines.length > 0 ? input.newsLines.join("\n") : "  No recent news found."}

## Source coverage
${coverageNote}

## Output instructions
Determine direction (bullish/bearish/neutral), confidence (0-100), and a rationale. The rationale must acknowledge the source coverage note above, and if direction is neutral, must name the conflicting signals. For citations, cite only the bracketed IDs that actually appear above (e.g. "filing_0", "news_2") -- do not invent an ID that isn't listed.

Also provide entry/target/stop-loss guidance, grounded in the actual current price and recent trading range above -- never invent a price level unrelated to real data:
- entryGuidance: plain-language guidance on whether current price looks like a reasonable entry, a better level to wait for, or (for bearish/neutral) whether to avoid new entries and what an existing holder should consider.
- targetPrice: a specific take-profit price if direction is bullish (or a level to consider exiting a long if bearish/neutral), grounded in the recent trading range/resistance -- null if direction is neutral and there's no clear level.
- stopLossPrice: a specific protective price -- for bullish, must be BELOW the current price; for bearish, must be ABOVE the current price (the level at which the bearish thesis would be invalidated for someone still holding). Null if direction is neutral.

(Response format is enforced separately via structured outputs -- this section only needs to guide *content*, not JSON shape.)`;
}
