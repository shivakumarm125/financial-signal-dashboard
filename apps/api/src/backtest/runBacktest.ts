import { prisma } from "@financial-adviser/shared";
import { assembleContextForTicker } from "../analysis/promptAssembly";
import { generateSignal } from "../analysis/claudeClient";
import { validateCitations, validateTradeLevels, applyConfidenceCapping } from "../analysis/signalValidation";
import { ingestHistoricalNews } from "../ingestion/finnhub/ingestNews";
import { checkOutcome } from "../analysis/signalOutcomes";

const MAX_ATTEMPTS = 2; // same retry policy as the live pipeline (C3)
const HORIZON_DAYS = 7; // A5's fixed accuracy-tracking horizon

export interface BacktestPointResult {
  asOfDate: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

/** A backtest date is only usable if there's enough PRIOR data for full technicals and enough SUBSEQUENT data to grade the 7-day horizon -- both are real, known constraints, not assumed. */
async function checkFeasibility(tickerId: string, asOfDate: Date): Promise<{ feasible: boolean; reason?: string }> {
  const priorBars = await prisma.priceBar.count({ where: { tickerId, date: { lte: asOfDate } } });
  if (priorBars < 200) {
    return { feasible: false, reason: `only ${priorBars} prior price bar(s) -- need 200 for a full 200-day moving average` };
  }

  const horizonEnd = addDays(asOfDate, HORIZON_DAYS);
  const subsequentBars = await prisma.priceBar.count({ where: { tickerId, date: { gt: asOfDate, lte: horizonEnd } } });
  if (subsequentBars === 0) {
    return { feasible: false, reason: "no known subsequent price data within the 7-day horizon" };
  }

  return { feasible: true };
}

/**
 * Simulates one historical signal: assembles context as-of a past date (no
 * lookahead -- see promptAssembly.ts), generates a real signal via Claude,
 * then grades it against REAL price action that has already happened. Every
 * point is either infeasible (skipped, not guessed at) or fully resolved --
 * there's no "pending" state in a backtest, since the future being graded
 * against is already known history.
 */
export async function runBacktestPoint(symbol: string, asOfDate: Date): Promise<BacktestPointResult> {
  const dateStr = asOfDate.toISOString().slice(0, 10);
  const ticker = await prisma.ticker.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!ticker) return { asOfDate: dateStr, status: "error", reason: "ticker not found -- must be ingested first" };

  const feasibility = await checkFeasibility(ticker.id, asOfDate);
  if (!feasibility.feasible) {
    return { asOfDate: dateStr, status: "skipped", reason: feasibility.reason };
  }

  // Historical news isn't stored by default (the live system only keeps the
  // last 14 days) -- fetch it for this date's window specifically. Does NOT
  // touch the live incremental-sync pointer (see ingestHistoricalNews).
  await ingestHistoricalNews(symbol, asOfDate);

  const context = await assembleContextForTicker(symbol, asOfDate);

  let lastFailureReason = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateSignal(context.promptText);
    if (result.status !== "ok") {
      return { asOfDate: dateStr, status: "error", reason: `${result.status}: ${result.message}` };
    }

    const citationsOk = validateCitations(result.signal.citations, context.citationMap);
    const tradeLevelsOk = validateTradeLevels(
      result.signal.direction,
      result.signal.targetPrice,
      result.signal.stopLossPrice,
      context.currentPrice
    );

    if (citationsOk && tradeLevelsOk) {
      const finalSignal = applyConfidenceCapping(result.signal, context.preTagDirections);

      const horizonEnd = addDays(asOfDate, HORIZON_DAYS);
      const subsequentBars = await prisma.priceBar.findMany({
        where: { tickerId: ticker.id, date: { gt: asOfDate, lte: horizonEnd } },
        orderBy: { date: "asc" },
      });

      const outcome = checkOutcome(
        finalSignal.direction,
        finalSignal.targetPrice,
        finalSignal.stopLossPrice,
        context.currentPrice,
        horizonEnd,
        subsequentBars.map((b) => ({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close) })),
        new Date() // always past horizonEnd for a valid backtest date -- never resolves as "pending"
      );

      await prisma.backtestSignal.create({
        data: {
          tickerId: ticker.id,
          asOfDate,
          entryPrice: context.currentPrice,
          direction: finalSignal.direction,
          confidence: finalSignal.confidence,
          rawConfidence: result.signal.confidence,
          rationale: finalSignal.rationale,
          entryGuidance: finalSignal.entryGuidance,
          targetPrice: finalSignal.targetPrice,
          stopLossPrice: finalSignal.stopLossPrice,
          outcome: outcome.status,
          outcomeDetail: outcome.detail,
        },
      });

      return { asOfDate: dateStr, status: "ok" };
    }

    lastFailureReason = !citationsOk ? "invalid citation" : "invalid trade levels";
  }

  return { asOfDate: dateStr, status: "error", reason: `failed validation after ${MAX_ATTEMPTS} attempts: ${lastFailureReason}` };
}

export async function runBacktest(symbol: string, asOfDates: Date[]): Promise<BacktestPointResult[]> {
  const results: BacktestPointResult[] = [];
  for (const date of asOfDates) {
    results.push(await runBacktestPoint(symbol, date));
  }
  return results;
}
