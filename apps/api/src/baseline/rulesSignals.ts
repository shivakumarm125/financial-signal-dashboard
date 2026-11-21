import { prisma } from "@financial-adviser/shared";
import { computeTechnicals, Bar } from "../ingestion/twelvedata/technicals";
import { persistSignal } from "../analysis/signalHistory";
import { ruleDirection, averageTrueRange, levelsFor, HORIZON_DAYS } from "./rulesBaseline";

/**
 * Live signals from the free rules engine -- what the pipeline uses when no
 * Claude key is configured. Same storage, grading and dashboard as Claude's
 * calls, marked engine = "rules" so the two track records never mix.
 *
 * Levels sit one average daily range (ATR) either side of the price: symmetric,
 * so the rule claims no more than it has shown it can do (see the comparison in
 * scripts/rules-baseline.ts). Confidence is a fixed, deliberately low 40 --
 * the rule has no measured edge, and the dashboard reads 40 as "Not very sure".
 */

const RULES_CONFIDENCE = 40;
const PRICE_BARS_NEEDED = 200;
const INSIDER_LOOKBACK_DAYS = 90;

export interface RuleSignalResult {
  symbol: string;
  status: "ok" | "skipped";
  direction?: string;
  reason?: string;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function rationaleFor(bars: Bar[], buys: number, earningsSoon: boolean, direction: string): string {
  const t = computeTechnicals(bars);
  const lines: string[] = ["This call was made by simple fixed rules, not AI."];
  if (earningsSoon) {
    lines.push(`The company reports earnings within the next ${HORIZON_DAYS} days. Prices can jump sharply either way around a report, so the rules make no call.`);
    return lines.join(" ");
  }
  if (t.priceAboveMa50 && t.priceAboveMa200) lines.push("The price is above its average for both the last 50 and 200 trading days, so it has been trending up.");
  else if (t.priceAboveMa50 === false && t.priceAboveMa200 === false) lines.push("The price is below its average for both the last 50 and 200 trading days, so it has been trending down.");
  else lines.push("The price is above one of its 50- and 200-day averages and below the other, so there's no clear trend.");
  lines.push(
    buys > 0
      ? `Company insiders made ${buys} open-market purchase${buys === 1 ? "" : "s"} in the last ${INSIDER_LOOKBACK_DAYS} days, which counts in favour of the stock.`
      : `There were no open-market insider purchases in the last ${INSIDER_LOOKBACK_DAYS} days. (Insider sales are ignored: they are usually routine.)`
  );
  lines.push(
    direction === "neutral"
      ? "Those don't point clearly one way, so there's no call this week."
      : `Together those point ${direction === "bullish" ? "up" : "down"}. The levels are set one typical day's price move either side of today's price.`
  );
  return lines.join(" ");
}

export async function generateRuleSignals(symbols: string[]): Promise<RuleSignalResult[]> {
  const results: RuleSignalResult[] = [];
  const now = new Date();

  for (const symbol of symbols) {
    const ticker = await prisma.ticker.findUnique({ where: { symbol } });
    if (!ticker) {
      results.push({ symbol, status: "skipped", reason: "not on the watchlist" });
      continue;
    }

    const recent = await prisma.priceBar.findMany({
      where: { tickerId: ticker.id },
      orderBy: { date: "desc" },
      take: PRICE_BARS_NEEDED + 20,
    });
    if (recent.length < PRICE_BARS_NEEDED) {
      results.push({ symbol, status: "skipped", reason: `only ${recent.length} days of prices; the rules need ${PRICE_BARS_NEEDED}` });
      continue;
    }
    const bars: Bar[] = recent
      .reverse()
      .map((b) => ({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) }));

    const filings = await prisma.insiderFiling.findMany({
      where: { tickerId: ticker.id, transactionDate: { gte: daysAgo(INSIDER_LOOKBACK_DAYS + 5) } },
      select: { transactionDate: true, filedAt: true, transactionCode: true },
    });
    const earnings = await prisma.earningsEvent.findMany({
      where: { tickerId: ticker.id, date: { gte: daysAgo(1) } },
      select: { date: true },
    });
    const earningsDates = earnings.map((e) => e.date);

    const decision = ruleDirection({ barsToDate: bars, filings, earningsDates, asOf: now });
    const entry = bars[bars.length - 1].close;
    const atr = averageTrueRange(bars) ?? entry * 0.02;
    const levels = levelsFor(decision.direction, entry, atr, atr);
    const round = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
    const buys = filings.filter((f) => f.transactionCode === "P" && f.transactionDate >= daysAgo(INSIDER_LOOKBACK_DAYS)).length;

    await persistSignal(
      ticker.id,
      {
        direction: decision.direction,
        confidence: RULES_CONFIDENCE,
        rationale: rationaleFor(bars, buys, decision.reason === "earnings inside horizon", decision.direction),
        entryGuidance: "",
        targetPrice: round(levels.target),
        stopLossPrice: round(levels.stop),
        citations: [],
      },
      RULES_CONFIDENCE,
      {},
      entry,
      "rules"
    );
    results.push({ symbol, status: "ok", direction: decision.direction });
  }
  return results;
}
