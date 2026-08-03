import { prisma, truncateSafely } from "@financial-adviser/shared";
import { getStoredTechnicals } from "../ingestion/twelvedata/ingestPrices";
import { Technicals } from "../ingestion/twelvedata/technicals";

// A5 prompt-bounding defaults (most-recent-N per source, Q21).
const INSIDER_LOOKBACK_DAYS = 90;
const MAX_INSIDER_FILINGS = 10;
const MAX_NEWS_ITEMS = 10;
const MAX_SOCIAL_ITEMS = 10;

// A5's fixed accuracy-tracking horizon. The prompt used to omit this entirely:
// levels were requested as "grounded in the recent trading range/resistance"
// with no time bound, then graded at exactly 7 days -- the model was answering
// a different question from the one it was scored on. Kept in sync with
// HORIZON_DAYS in signalOutcomes/runBacktest.
const SIGNAL_HORIZON_DAYS = 7;

const EARNINGS_HOUR_LABELS: Record<string, string> = {
  bmo: "before market open",
  amc: "after market close",
  dmh: "during market hours",
};

function formatEarnings(e: EarningsInfo): string {
  if (!e.hasData) {
    return "  No earnings-date data available for this ticker.";
  }

  const lines: string[] = [];

  if (e.nextDate === null) {
    lines.push("  Next scheduled report: none on the calendar.");
  } else {
    const hour = e.nextHour ? ` (${EARNINGS_HOUR_LABELS[e.nextHour] ?? e.nextHour})` : "";
    const est = e.nextEpsEstimate !== null ? `, consensus EPS estimate ${e.nextEpsEstimate}` : "";
    const days = e.daysUntilNext;
    const inHorizon = days !== null && days <= SIGNAL_HORIZON_DAYS;
    lines.push(
      `  Next scheduled report: ${e.nextDate}${hour} -- ${days} day(s) away${est}.` +
        (inHorizon
          ? `  ** THIS FALLS INSIDE THE ${SIGNAL_HORIZON_DAYS}-DAY SIGNAL HORIZON. **`
          : `  (outside the ${SIGNAL_HORIZON_DAYS}-day horizon)`)
    );
  }

  if (e.lastDate !== null) {
    const actual = e.lastEpsActual !== null ? `EPS ${e.lastEpsActual}` : "EPS not reported";
    const vs =
      e.lastEpsActual !== null && e.lastEpsEstimate !== null
        ? ` vs ${e.lastEpsEstimate} expected (${e.lastEpsActual >= e.lastEpsEstimate ? "beat/in line" : "miss"})`
        : "";
    lines.push(`  Most recent report: ${e.lastDate} -- ${actual}${vs}.`);
  }

  return lines.join("\n");
}

export interface CitationRecord {
  type: "filing" | "news" | "social";
  recordId: string; // the real DB row id, resolved from the short prompt-scoped id below
}

export interface SourceCoverage {
  filings: boolean;
  price: boolean;
  news: boolean;
  social: boolean; // B4 (StockTwits), wired 2026-08-02; false when the ticker has no posts stored
}

export type PreTagDirection = "bullish" | "bearish" | "neutral";

export interface EarningsInfo {
  hasData: boolean;
  nextDate: string | null;
  nextHour: string | null; // "bmo" | "amc" | "dmh"
  daysUntilNext: number | null;
  nextEpsEstimate: number | null;
  lastDate: string | null;
  lastEpsActual: number | null;
  lastEpsEstimate: number | null;
}

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

function daysAgo(n: number, from: Date): Date {
  const d = new Date(from);
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
 * of the 4 sources (B1 filings, B2 price/technicals, B3 news, B4 social) have
 * data for this ticker. Any source with nothing is reported as a genuine
 * coverage gap per A5's Q20 rule, never silently omitted.
 *
 * `asOfDate` (default: now) restricts every source to data at or before that
 * date -- this is what makes backtesting (2026-07-21) valid rather than
 * lookahead-biased. A "signal" simulated for a past date must only see what
 * actually existed by then, never data from after it.
 */
export async function assembleContextForTicker(symbol: string, asOfDate: Date = new Date()): Promise<AssembledContext> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!ticker) {
    throw new Error(`Ticker ${symbol} not found -- must be ingested (B1/B2/B3) before assembling a prompt.`);
  }

  const citationMap: Record<string, CitationRecord> = {};

  // --- Insider filings: pre-tagged (A5 hybrid design) ---
  const filings = await prisma.insiderFiling.findMany({
    where: { tickerId: ticker.id, transactionDate: { gte: daysAgo(INSIDER_LOOKBACK_DAYS, asOfDate), lte: asOfDate } },
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
  const technicals = await getStoredTechnicals(ticker.id, asOfDate);
  const hasPriceData = technicals.ma50 !== null || technicals.ma200 !== null;

  // --- News: raw (A5) -- no sentiment pre-tagging, individually citable ---
  const news = await prisma.newsArticle.findMany({
    where: { tickerId: ticker.id, publishedAt: { lte: asOfDate } },
    orderBy: { publishedAt: "desc" },
    take: MAX_NEWS_ITEMS,
  });

  const newsLines = news.map((n, i) => {
    const id = `news_${i}`;
    citationMap[id] = { type: "news", recordId: n.id };
    const summary = n.summary ? ` — ${n.summary}` : "";
    return `  [${id}] ${n.publishedAt.toISOString().slice(0, 10)} | ${n.source} | ${n.headline}${summary}`;
  });

  // --- Social/forum (B4): raw, individually citable, explicitly unverified ---
  // Ordered by author standing rather than recency: the cap is 10 items and a
  // busy cashtag produces dozens of one-line posts an hour, so taking the
  // newest would fill the prompt with noise from brand-new accounts.
  const social = await prisma.socialPost.findMany({
    where: { tickerId: ticker.id, postedAt: { lte: asOfDate } },
    orderBy: [{ credibilityScore: "desc" }, { postedAt: "desc" }],
    take: MAX_SOCIAL_ITEMS,
  });

  const socialLines = social.map((s, i) => {
    const id = `social_${i}`;
    citationMap[id] = { type: "social", recordId: s.id };
    const sentiment = s.declaredSentiment ? ` | poster tagged it ${s.declaredSentiment}` : "";
    const followers = s.authorFollowers !== null ? `${s.authorFollowers} followers` : "unknown reach";
    return (
      `  [${id}] ${s.postedAt.toISOString().slice(0, 10)} | @${s.author ?? "unknown"} (${followers}) | ` +
      `standing ${s.credibilityScore}/100${sentiment} | ` +
      truncateSafely(s.body, 260).replace(/\s+/g, " ")
    );
  });

  // Aggregate of what the forum is claiming, so the model can see the balance
  // without having to count lines. Self-declared tags only -- a poster saying
  // "Bullish" is a statement of position, not evidence.
  const declaredBullish = social.filter((s) => s.declaredSentiment === "Bullish").length;
  const declaredBearish = social.filter((s) => s.declaredSentiment === "Bearish").length;

  // --- Earnings calendar (B10) ---
  // Backtest-safe: both queries are bounded by asOfDate, so a simulated past
  // date never sees a report that hadn't happened yet. Knowing a FUTURE date is
  // legitimate (companies announce them in advance); knowing a future RESULT is
  // not, which is why actuals are only ever read from the past query.
  const nextEarnings = await prisma.earningsEvent.findFirst({
    where: { tickerId: ticker.id, date: { gte: asOfDate } },
    orderBy: { date: "asc" },
  });
  const lastEarnings = await prisma.earningsEvent.findFirst({
    where: { tickerId: ticker.id, date: { lt: asOfDate } },
    orderBy: { date: "desc" },
  });

  const earningsInfo: EarningsInfo = {
    hasData: Boolean(nextEarnings || lastEarnings),
    nextDate: nextEarnings ? nextEarnings.date.toISOString().slice(0, 10) : null,
    nextHour: nextEarnings?.hour ?? null,
    daysUntilNext: nextEarnings
      ? Math.round((nextEarnings.date.getTime() - asOfDate.getTime()) / 86_400_000)
      : null,
    nextEpsEstimate: nextEarnings?.epsEstimate ? Number(nextEarnings.epsEstimate) : null,
    lastDate: lastEarnings ? lastEarnings.date.toISOString().slice(0, 10) : null,
    lastEpsActual: lastEarnings?.epsActual ? Number(lastEarnings.epsActual) : null,
    lastEpsEstimate: lastEarnings?.epsEstimate ? Number(lastEarnings.epsEstimate) : null,
  };

  const sourceCoverage: SourceCoverage = {
    filings: filings.length > 0,
    price: hasPriceData,
    news: news.length > 0,
    social: social.length > 0,
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
    socialLines,
    declaredBullish,
    declaredBearish,
    sourceCoverage,
    earningsInfo,
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
  socialLines: string[];
  declaredBullish: number;
  declaredBearish: number;
  sourceCoverage: SourceCoverage;
  earningsInfo: EarningsInfo;
}): string {
  const missingSources: string[] = [];
  if (!input.sourceCoverage.filings) missingSources.push("insider filings");
  if (!input.sourceCoverage.price) missingSources.push("price/technicals");
  if (!input.sourceCoverage.news) missingSources.push("news");
  if (!input.sourceCoverage.social) missingSources.push("social/forum sentiment");

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

## Social/forum chatter (UNVERIFIED speculation — not fact)
${
  input.socialLines.length > 0
    ? `Public StockTwits posts. Treat every line below as unverified opinion from anonymous retail traders, never as evidence of fact. Do not repeat a claim from here as though it were established; at most note that a claim is circulating, and say where it came from.

Self-declared sentiment in this sample: ${input.declaredBullish} tagged Bullish, ${input.declaredBearish} tagged Bearish (posters tag their own messages; many don't). This is what people say they believe, not evidence they are right — retail sentiment is frequently strongest at exactly the wrong moment.

The "standing" figure is NOT a truth score. It reflects the poster's follower count, account age and history — a widely-followed, long-established account can be confidently wrong. Use it only to judge whether a view is coming from an established account or a brand-new one, and weigh this whole section well below filings, price and news.

${input.socialLines.join("\n")}`
    : "  No social/forum data available."
}

## Earnings calendar
${formatEarnings(input.earningsInfo)}

## Source coverage
${coverageNote}

## Output instructions
**This signal will be evaluated over a ${SIGNAL_HORIZON_DAYS}-day horizon.** Every judgement below -- direction, confidence, and especially the price levels -- must be about what is likely to happen in the next ${SIGNAL_HORIZON_DAYS} days, not about where the stock may go eventually. If the earnings section above shows a report scheduled inside that window, treat it as a material source of two-sided risk: it can invalidate a directional call regardless of how the filings, technicals and news currently read, and your confidence should reflect that uncertainty rather than ignore it.

Determine direction (bullish/bearish/neutral), confidence (0-100), and a rationale. The rationale must acknowledge the source coverage note above, and if direction is neutral, must name the conflicting signals. For citations, cite only the bracketed IDs that actually appear above (e.g. "filing_0", "news_2", "social_1") -- do not invent an ID that isn't listed.

Also provide entry/target/stop-loss guidance, grounded in the actual current price and recent trading range above -- never invent a price level unrelated to real data:
- entryGuidance: plain-language guidance on whether current price looks like a reasonable entry, a better level to wait for, or (for bearish/neutral) whether to avoid new entries and what an existing holder should consider.
- targetPrice: a specific take-profit price if direction is bullish (or a level to consider exiting a long if bearish/neutral), grounded in the recent trading range/resistance. It must be a level the stock could plausibly REACH within ${SIGNAL_HORIZON_DAYS} days given its recent daily ranges -- a technically valid level that would realistically take months to reach is wrong here. Null if direction is neutral and there's no clear level.
- stopLossPrice: a specific protective price -- for bullish, must be BELOW the current price; for bearish, must be ABOVE the current price (the level at which the bearish thesis would be invalidated for someone still holding). Set it against the stock's normal ${SIGNAL_HORIZON_DAYS}-day volatility, so ordinary noise doesn't trigger it. Null if direction is neutral.

(Response format is enforced separately via structured outputs -- this section only needs to guide *content*, not JSON shape.)`;
}
