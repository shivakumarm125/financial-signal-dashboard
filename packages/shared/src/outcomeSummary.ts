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
}

/** Outcome statuses where a target or stop level was actually touched. */
const TERMINAL_LEVEL_OUTCOMES = new Set(["hit_target", "hit_stop", "ambiguous_same_day"]);

/**
 * Pulls the resolution date out of the detail string. checkOutcome() writes
 * these itself in a fixed "... on YYYY-MM-DD ..." shape, so this is parsing our
 * own output, not a third party's. If the format ever changes this degrades to
 * "no distinct-day info" rather than to a wrong number.
 *
 * (Worth storing as a real column eventually — see the follow-up note in
 * TICKETS.md C5 — but that needs a migration plus a backfill of existing rows.)
 */
function resolutionDate(detail: string | null): string | null {
  if (!detail) return null;
  const match = detail.match(/on (\d{4}-\d{2}-\d{2})/);
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
    const d = resolutionDate(r.outcomeDetail);
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
  return summarizeOutcomes(evaluated.map((s) => ({ outcome: s.outcome!, outcomeDetail: s.outcomeDetail })));
}

/** Same summary shape, but for backtest results (a separate table -- see BacktestSignal). */
export async function getBacktestHitRateSummary(): Promise<HitRateSummary> {
  const evaluated = await prisma.backtestSignal.findMany();
  return summarizeOutcomes(evaluated.map((s) => ({ outcome: s.outcome, outcomeDetail: s.outcomeDetail })));
}
