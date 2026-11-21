import { computeTechnicals, Bar } from "../ingestion/twelvedata/technicals";

/**
 * A deliberately simple, free, deterministic signal built only from the
 * pre-tagged inputs Claude already sees. It exists to answer one question:
 * does Claude's direction call beat what a few lines of arithmetic produce
 * from the same data? If not, Claude's cost buys nothing measurable.
 *
 * Rules, each traceable to something this project has already observed:
 * - Trend: price above both the 50- and 200-day MAs scores +1, below both -1
 *   (A5's price pre-tag, unchanged).
 * - Insider: open-market BUYS (code P) in the last 90 days score +1. Sales are
 *   ignored -- executives sell on schedules (10b5-1 plans, tax, diversification),
 *   so A5's net-shares pre-tag reads "bearish" for nearly every large cap and
 *   carries little information. A real buy with personal money is rarer and
 *   less ambiguous.
 * - Earnings inside the 7-day horizon forces neutral: B10 exists because a
 *   signal issued blind to an earnings print was the one diagnosed production
 *   failure, and a rule can't judge a print any better than a coin.
 * Score > 0 is bullish, < 0 bearish, 0 neutral.
 */

export const HORIZON_DAYS = 7;
const INSIDER_LOOKBACK_DAYS = 90;
const ATR_PERIOD = 14;

export type Direction = "bullish" | "bearish" | "neutral";

export interface FilingLite {
  transactionDate: Date;
  filedAt: Date;
  transactionCode: string;
}

export interface RuleInputs {
  /** All bars up to and including the as-of date, oldest first. */
  barsToDate: Bar[];
  filings: FilingLite[];
  earningsDates: Date[];
  asOf: Date;
}

export interface RuleDecision {
  direction: Direction;
  reason: string;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

export function ruleDirection({ barsToDate, filings, earningsDates, asOf }: RuleInputs): RuleDecision {
  const horizonEnd = addDays(asOf, HORIZON_DAYS);
  // Same day counts: an after-close report on the as-of date lands inside the horizon.
  const dayStart = new Date(asOf.toISOString().slice(0, 10) + "T00:00:00Z");
  const earningsInHorizon = earningsDates.some((d) => d >= dayStart && d <= horizonEnd);
  if (earningsInHorizon) return { direction: "neutral", reason: "earnings inside horizon" };

  const t = computeTechnicals(barsToDate);
  let score = 0;
  const parts: string[] = [];
  if (t.priceAboveMa50 === true && t.priceAboveMa200 === true) {
    score += 1;
    parts.push("above both MAs");
  } else if (t.priceAboveMa50 === false && t.priceAboveMa200 === false) {
    score -= 1;
    parts.push("below both MAs");
  }

  const lookbackStart = addDays(asOf, -INSIDER_LOOKBACK_DAYS);
  const buys = filings.filter(
    (f) => f.transactionCode === "P" && f.transactionDate >= lookbackStart && f.transactionDate <= asOf && f.filedAt <= asOf
  ).length;
  if (buys > 0) {
    score += 1;
    parts.push(`${buys} insider buy(s)`);
  }

  const direction: Direction = score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";
  return { direction, reason: parts.length ? parts.join(", ") : "no trend, no insider buys" };
}

/** Average true range over the last ATR_PERIOD bars, or null with too little history. */
export function averageTrueRange(barsToDate: Bar[]): number | null {
  if (barsToDate.length < ATR_PERIOD + 1) return null;
  const recent = barsToDate.slice(-(ATR_PERIOD + 1));
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    const { high, low } = recent[i];
    const prevClose = recent[i - 1].close;
    sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  return sum / ATR_PERIOD;
}

/** Target/stop at the given distances from entry, on the side the direction implies. */
export function levelsFor(direction: Direction, entry: number, targetDistance: number, stopDistance: number) {
  if (direction === "neutral") return { target: null, stop: null };
  const sign = direction === "bullish" ? 1 : -1;
  return { target: entry + sign * targetDistance, stop: entry - sign * stopDistance };
}
