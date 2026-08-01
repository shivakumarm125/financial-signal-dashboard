import { prisma } from "./client";

/**
 * "Reachability" — an estimate of whether a signal's suggested TARGET PRICE
 * will actually be reached inside the 7-day horizon.
 *
 * This is deliberately NOT the same number as the signal's own `confidence`.
 * Confidence is Claude's self-assessment that the *direction* is right; it
 * says nothing about whether the specific price level it picked is a realistic
 * distance to travel in a week. A 66%-confidence bearish call with a target 15%
 * below spot is far less likely to resolve than the same call with a 2% target.
 *
 * It is also NOT derived from this system's own signal track record. As of
 * 2026-08-01 that track record is 5 target/stop outcomes, 4 of which resolved
 * on the same 2026-07-31 down day — effectively 2 independent episodes. A
 * percentage computed from that would be noise wearing a probability's
 * clothing. The base rate here comes from the ticker's own stored daily price
 * bars (~250 of them, a real sample), asking a question those bars can
 * genuinely answer: when this stock moved in this direction over 7 days, how
 * often did it move at least this far?
 *
 * Decomposition (both factors are displayed in the UI, and they multiply to
 * the result — no hidden fudge factors):
 *
 *   reachability = P(direction correct) x P(moves >= X | direction correct)
 *                = confidence/100     x conditionalBaseRate
 *
 * The conditional form matters: the *unconditional* rate of "moved >= X down
 * in 7 days" already bakes in the roughly-half-the-time chance of the stock
 * going down at all, so multiplying it by confidence would double-count the
 * direction and report a systematically too-low number.
 */

export const REACHABILITY_HORIZON_DAYS = 7;
export const REACHABILITY_LOOKBACK_DAYS = 365;

export interface ReachabilityBar {
  date: Date;
  high: number;
  low: number;
  close: number;
}

export interface ReachabilityResult {
  available: boolean;
  /** Why it could not be computed — shown to the user instead of a fake number. */
  reason?: string;
  /** How far the target sits from the entry price, as a fraction (0.069 = 6.9%). */
  requiredMovePct: number;
  /** Windows where the stock moved in the signal's direction at all. */
  directionalWindows: number;
  /** Of those, how many travelled at least `requiredMovePct`. */
  windowsReachingTarget: number;
  /** windowsReachingTarget / directionalWindows, 0-1. */
  conditionalBaseRate: number;
  /** The signal's own direction confidence, 0-100, passed straight through. */
  confidence: number;
  /** Final score, 0-100. */
  reachability: number;
  /** Total 7-day windows examined, directional or not — the raw sample size. */
  totalWindows: number;
}

function unavailable(reason: string): ReachabilityResult {
  return {
    available: false,
    reason,
    requiredMovePct: 0,
    directionalWindows: 0,
    windowsReachingTarget: 0,
    conditionalBaseRate: 0,
    confidence: 0,
    reachability: 0,
    totalWindows: 0,
  };
}

/**
 * Pure scoring — no DB access, so the arithmetic can be checked directly.
 * `bars` must be sorted ascending by date.
 *
 * Windows use the same high/low convention as checkOutcome() grades with
 * (bullish targets are checked against the window's high, bearish against its
 * low), so the score is measuring the same event the outcome checker will
 * later record.
 */
export function scoreReachability(params: {
  direction: string;
  entryPrice: number;
  targetPrice: number | null;
  confidence: number;
  bars: ReachabilityBar[];
  horizonDays?: number;
}): ReachabilityResult {
  const { direction, entryPrice, targetPrice, confidence, bars } = params;
  const horizonDays = params.horizonDays ?? REACHABILITY_HORIZON_DAYS;

  if (direction === "neutral") {
    return unavailable("Neutral signal — no directional target to reach.");
  }
  if (targetPrice === null) {
    return unavailable("No target price set on this signal.");
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return unavailable("No current price available.");
  }

  const isBullish = direction === "bullish";
  const requiredMovePct = Math.abs(targetPrice - entryPrice) / entryPrice;

  // A target on the wrong side of spot is already met; don't dress that up as
  // a probability.
  if ((isBullish && targetPrice <= entryPrice) || (!isBullish && targetPrice >= entryPrice)) {
    return unavailable("Target is already at or past the current price.");
  }

  let totalWindows = 0;
  let directionalWindows = 0;
  let windowsReachingTarget = 0;

  for (let i = 0; i < bars.length; i++) {
    const start = bars[i];
    const windowEnd = new Date(start.date);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + horizonDays);

    let extreme: number | null = null;
    for (let j = i + 1; j < bars.length; j++) {
      const bar = bars[j];
      if (bar.date > windowEnd) break;
      const candidate = isBullish ? bar.high : bar.low;
      if (extreme === null) extreme = candidate;
      else extreme = isBullish ? Math.max(extreme, candidate) : Math.min(extreme, candidate);
    }

    // A window with no subsequent bars (the tail of the series) isn't a
    // sample — skip it rather than counting it as a miss.
    if (extreme === null) continue;
    totalWindows++;

    const move = isBullish ? (extreme - start.close) / start.close : (start.close - extreme) / start.close;
    if (move <= 0) continue; // didn't move in this direction at all

    directionalWindows++;
    if (move >= requiredMovePct) windowsReachingTarget++;
  }

  if (directionalWindows === 0) {
    return unavailable("Not enough price history to estimate a base rate.");
  }

  const conditionalBaseRate = windowsReachingTarget / directionalWindows;
  const reachability = Math.round((confidence / 100) * conditionalBaseRate * 100);

  return {
    available: true,
    requiredMovePct,
    directionalWindows,
    windowsReachingTarget,
    conditionalBaseRate,
    confidence,
    reachability,
    totalWindows,
  };
}

/** DB-backed wrapper: loads the ticker's recent bars and scores against the latest close. */
export async function computeReachability(params: {
  tickerId: string;
  direction: string;
  targetPrice: number | null;
  confidence: number;
  lookbackDays?: number;
}): Promise<ReachabilityResult> {
  const lookbackDays = params.lookbackDays ?? REACHABILITY_LOOKBACK_DAYS;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - lookbackDays);

  const rows = await prisma.priceBar.findMany({
    where: { tickerId: params.tickerId, date: { gte: from } },
    orderBy: { date: "asc" },
  });

  if (rows.length === 0) return unavailable("No price history stored for this ticker.");

  const bars: ReachabilityBar[] = rows.map((b) => ({
    date: b.date,
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
  }));

  return scoreReachability({
    direction: params.direction,
    entryPrice: bars[bars.length - 1].close,
    targetPrice: params.targetPrice,
    confidence: params.confidence,
    bars,
  });
}
