import { prisma } from "@financial-adviser/shared";
import { assembleContextForTicker, AssembledContext } from "../analysis/promptAssembly";
import { generateValidatedBatch } from "../analysis/generateValidatedSignal";
import { ingestHistoricalNews } from "../ingestion/finnhub/ingestNews";
import { checkOutcome } from "../analysis/signalOutcomes";

const HORIZON_DAYS = 7; // A5's fixed accuracy-tracking horizon

export interface BacktestPointResult {
  asOfDate: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
}

export interface BacktestPoint {
  symbol: string;
  asOfDate: Date;
}

export interface PreparedBacktestPoint extends BacktestPoint {
  key: string;
  tickerId: string;
  context: AssembledContext;
}

export type BacktestPointOutcome = BacktestPoint & { result: BacktestPointResult };

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
 * Everything short of calling Claude: feasibility, historical news, and the
 * as-of-date prompt (no lookahead -- see promptAssembly.ts). Split out so a
 * caller can price a run with the free countTokens API before spending.
 */
export async function prepareBacktestPoints(
  points: BacktestPoint[]
): Promise<{ prepared: PreparedBacktestPoint[]; unusable: BacktestPointOutcome[] }> {
  const prepared: PreparedBacktestPoint[] = [];
  const unusable: BacktestPointOutcome[] = [];

  for (const point of points) {
    const dateStr = point.asOfDate.toISOString().slice(0, 10);
    const ticker = await prisma.ticker.findUnique({ where: { symbol: point.symbol.toUpperCase() } });
    if (!ticker) {
      unusable.push({ ...point, result: { asOfDate: dateStr, status: "error", reason: "ticker not found -- must be ingested first" } });
      continue;
    }

    const feasibility = await checkFeasibility(ticker.id, point.asOfDate);
    if (!feasibility.feasible) {
      unusable.push({ ...point, result: { asOfDate: dateStr, status: "skipped", reason: feasibility.reason } });
      continue;
    }

    // Historical news isn't stored by default (the live system only keeps the
    // last 14 days) -- fetch it for this date's window specifically. Does NOT
    // touch the live incremental-sync pointer (see ingestHistoricalNews).
    await ingestHistoricalNews(point.symbol, point.asOfDate);

    prepared.push({
      ...point,
      key: `bt-${ticker.symbol}-${dateStr.replace(/-/g, "")}`,
      tickerId: ticker.id,
      context: await assembleContextForTicker(point.symbol, point.asOfDate),
    });
  }
  return { prepared, unusable };
}

/**
 * Simulates historical signals: generates them all in one half-price batch
 * (same validation and retry as the live pipeline), then grades each against
 * REAL price action that has already happened. There's no "pending" state in
 * a backtest, since the future being graded against is already known history.
 */
export async function runPreparedBacktest(prepared: PreparedBacktestPoint[]): Promise<BacktestPointOutcome[]> {
  const outcomes = await generateValidatedBatch(prepared.map((p) => ({ key: p.key, context: p.context, purpose: "backtest" as const })));

  const results: BacktestPointOutcome[] = [];
  for (const p of prepared) {
    const dateStr = p.asOfDate.toISOString().slice(0, 10);
    const outcome = outcomes.get(p.key)!;
    if (outcome.status !== "ok") {
      results.push({ ...p, result: { asOfDate: dateStr, status: "error", reason: `${outcome.status}: ${outcome.message}` } });
      continue;
    }
    const finalSignal = outcome.signal;

    const horizonEnd = addDays(p.asOfDate, HORIZON_DAYS);
    const subsequentBars = await prisma.priceBar.findMany({
      where: { tickerId: p.tickerId, date: { gt: p.asOfDate, lte: horizonEnd } },
      orderBy: { date: "asc" },
    });

    const graded = checkOutcome(
      finalSignal.direction,
      finalSignal.targetPrice,
      finalSignal.stopLossPrice,
      p.context.currentPrice,
      horizonEnd,
      subsequentBars.map((b) => ({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close) })),
      new Date() // always past horizonEnd for a valid backtest date -- never resolves as "pending"
    );

    await prisma.backtestSignal.create({
      data: {
        tickerId: p.tickerId,
        asOfDate: p.asOfDate,
        entryPrice: p.context.currentPrice,
        direction: finalSignal.direction,
        confidence: finalSignal.confidence,
        rawConfidence: outcome.rawConfidence,
        rationale: finalSignal.rationale,
        entryGuidance: finalSignal.entryGuidance,
        targetPrice: finalSignal.targetPrice,
        stopLossPrice: finalSignal.stopLossPrice,
        outcome: graded.status,
        outcomeDetail: graded.detail,
        outcomeResolvedOn: graded.resolvedOn ?? null,
      },
    });
    results.push({ ...p, result: { asOfDate: dateStr, status: "ok" } });
  }
  return results;
}

export async function runBacktest(symbol: string, asOfDates: Date[]): Promise<BacktestPointResult[]> {
  const { prepared, unusable } = await prepareBacktestPoints(asOfDates.map((asOfDate) => ({ symbol, asOfDate })));
  const ran = await runPreparedBacktest(prepared);
  const byDate = new Map([...unusable, ...ran].map((r) => [r.asOfDate.getTime(), r.result]));
  return asOfDates.map((d) => byDate.get(d.getTime())!);
}
