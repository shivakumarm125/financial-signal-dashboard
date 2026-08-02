import { prisma } from "./client";

/**
 * Hit-rate reporting for signal history.
 *
 * Lives in `shared` rather than in the api app because the web dashboard needs
 * the same numbers the CLI scripts print, and two implementations of a hit rate
 * is exactly the kind of thing that quietly drifts apart.
 */

export interface HitRateSummary {
  counts: Record<string, number>;
  targetHitRate: number | null;
  targetStopEvaluated: number;
  directionAccuracy: number | null;
  directionOnlyEvaluated: number;
  totalEvaluated: number;
  /**
   * How many DISTINCT calendar days the target/stop outcomes actually resolved
   * on. This is the honest sample size: on 2026-07-31 a single down day
   * stopped out four separate signals, so a "5 outcomes" headline was really
   * describing 2 independent market episodes. Without this, every hit rate
   * this system reports overstates how much evidence sits behind it.
   */
  distinctResolutionDays: number;
}

export interface OutcomeRow {
  outcome: string;
  outcomeDetail: string | null;
  outcomeResolvedOn?: Date | null;
}

/** Outcome statuses where a target or stop level was actually touched. */
const TERMINAL_LEVEL_OUTCOMES = new Set(["hit_target", "hit_stop", "ambiguous_same_day"]);

/**
 * The market day an outcome actually resolved on.
 *
 * Reads the stored `outcomeResolvedOn` column. The regex fallback covers only
 * rows written before that column existed (2026-08-02) plus anything that
 * escapes the backfill — but until then the regex WAS the mechanism, which made
 * the distinct-episode count behind every hit rate on this dashboard depend on
 * the wording of a prose sentence.
 */
function resolutionDate(row: OutcomeRow): string | null {
  if (row.outcomeResolvedOn) return row.outcomeResolvedOn.toISOString().slice(0, 10);
  const match = row.outcomeDetail?.match(/on (\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Reports target-hit-rate and directional-accuracy as two SEPARATE numbers,
 * not blended into one -- actually hitting the suggested target is a
 * meaningfully stronger result than merely being directionally right when
 * neither level was reached, and conflating them would overstate accuracy.
 */
export function summarizeOutcomes(rows: OutcomeRow[]): HitRateSummary {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  }

  const targetStopEvaluated = (counts.hit_target ?? 0) + (counts.hit_stop ?? 0);
  const directionOnlyEvaluated = (counts.expired_direction_correct ?? 0) + (counts.expired_direction_wrong ?? 0);

  const days = new Set<string>();
  for (const r of rows) {
    if (!TERMINAL_LEVEL_OUTCOMES.has(r.outcome)) continue;
    const d = resolutionDate(r);
    if (d) days.add(d);
  }

  return {
    counts,
    targetHitRate: targetStopEvaluated > 0 ? Math.round(((counts.hit_target ?? 0) / targetStopEvaluated) * 100) : null,
    targetStopEvaluated,
    directionAccuracy:
      directionOnlyEvaluated > 0 ? Math.round(((counts.expired_direction_correct ?? 0) / directionOnlyEvaluated) * 100) : null,
    directionOnlyEvaluated,
    totalEvaluated: rows.length,
    distinctResolutionDays: days.size,
  };
}

export async function getHitRateSummary(): Promise<HitRateSummary> {
  const evaluated = await prisma.signalRecord.findMany({ where: { outcome: { not: null } } });
  return summarizeOutcomes(evaluated.map((s) => ({ outcome: s.outcome!, outcomeDetail: s.outcomeDetail, outcomeResolvedOn: s.outcomeResolvedOn })));
}

/**
 * Per-ticker track record.
 *
 * This is the more meaningful unit, and not only because of sample size.
 * Tickers behave differently enough that pooling them describes none of them:
 * AAPL resolves only 38.8% of its 7-day windows cleanly while COIN resolves
 * 96.8% (see B9's screening). A blended hit rate mixes populations, so it stays
 * the least informative view no matter how much data accumulates. It is also
 * the number behind a real decision -- whether a given ticker is worth
 * continuing to track.
 */
export async function getHitRateSummaryForTicker(tickerId: string): Promise<HitRateSummary> {
  const evaluated = await prisma.signalRecord.findMany({ where: { tickerId, outcome: { not: null } } });
  return summarizeOutcomes(evaluated.map((s) => ({ outcome: s.outcome!, outcomeDetail: s.outcomeDetail, outcomeResolvedOn: s.outcomeResolvedOn })));
}

/** Same summary shape, but for backtest results (a separate table -- see BacktestSignal). */
export async function getBacktestHitRateSummary(): Promise<HitRateSummary> {
  const evaluated = await prisma.backtestSignal.findMany();
  return summarizeOutcomes(evaluated.map((s) => ({ outcome: s.outcome, outcomeDetail: s.outcomeDetail, outcomeResolvedOn: s.outcomeResolvedOn })));
}

/** Per-ticker backtest summary, kept separate from live signals for the same reason the global one is. */
export async function getBacktestHitRateSummaryForTicker(tickerId: string): Promise<HitRateSummary> {
  const evaluated = await prisma.backtestSignal.findMany({ where: { tickerId } });
  return summarizeOutcomes(evaluated.map((s) => ({ outcome: s.outcome, outcomeDetail: s.outcomeDetail, outcomeResolvedOn: s.outcomeResolvedOn })));
}
