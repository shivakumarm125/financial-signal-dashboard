import { prisma } from "@financial-adviser/shared";

export type SignalOutcomeStatus =
  | "pending"
  | "hit_target"
  | "hit_stop"
  | "ambiguous_same_day"
  | "expired_direction_correct"
  | "expired_direction_wrong"
  | "no_evaluation";

export interface OutcomeBar {
  date: Date;
  high: number;
  low: number;
  close: number;
}

export interface OutcomeResult {
  status: SignalOutcomeStatus;
  detail: string;
}

/**
 * Checks a signal's real target/stop-loss levels against actual daily price
 * bars since it was generated (finishing C5, 2026-07-20). Uses daily
 * high/low, not just close, since that's what would actually trigger a
 * target or stop in practice. `bars` must be strictly after the signal's
 * creation date, sorted ascending.
 *
 * If both target and stop are touched on the same daily bar, we can't tell
 * from daily data which happened first -- reported as "ambiguous_same_day"
 * rather than guessed.
 *
 * If the 7-day horizon passes with neither level hit, falls back to a
 * softer directional check (did price move the way the call said) -- this
 * is a weaker signal of usefulness than actually hitting the suggested
 * target, and is reported as a separate status so the two aren't conflated.
 */
export function checkOutcome(
  direction: string,
  targetPrice: number | null,
  stopLossPrice: number | null,
  entryPrice: number | null,
  targetDate: Date,
  bars: OutcomeBar[],
  today: Date
): OutcomeResult {
  if (direction === "neutral" || targetPrice === null || stopLossPrice === null) {
    return { status: "no_evaluation", detail: "Neutral signal or no target/stop set -- nothing to grade." };
  }

  const isBullish = direction === "bullish";

  for (const bar of bars) {
    const hitTarget = isBullish ? bar.high >= targetPrice : bar.low <= targetPrice;
    const hitStop = isBullish ? bar.low <= stopLossPrice : bar.high >= stopLossPrice;
    const dateStr = bar.date.toISOString().slice(0, 10);

    if (hitTarget && hitStop) {
      return {
        status: "ambiguous_same_day",
        detail: `Both target and stop touched on ${dateStr} (high $${bar.high}, low $${bar.low}) -- can't tell which came first from daily data.`,
      };
    }
    if (hitTarget) {
      return { status: "hit_target", detail: `Target $${targetPrice} reached on ${dateStr} (high $${bar.high}).` };
    }
    if (hitStop) {
      return { status: "hit_stop", detail: `Stop-loss $${stopLossPrice} reached on ${dateStr} (low $${bar.low}).` };
    }
  }

  if (today < targetDate) {
    return { status: "pending", detail: "7-day horizon not reached yet; neither level hit so far." };
  }

  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : entryPrice;
  if (entryPrice === null || lastClose === null) {
    return { status: "no_evaluation", detail: "Insufficient price data to evaluate." };
  }
  const movedUp = lastClose > entryPrice;
  const directionCorrect = isBullish ? movedUp : !movedUp;
  return {
    status: directionCorrect ? "expired_direction_correct" : "expired_direction_wrong",
    detail: `Neither target nor stop hit by the 7-day mark. Price moved from $${entryPrice} to $${lastClose} (${
      directionCorrect ? "matches" : "contradicts"
    } the ${direction} call).`,
  };
}

/** Finds every signal without a terminal outcome yet and checks it against real price data. */
export async function checkAllPendingOutcomes(): Promise<{ checked: number; updated: number }> {
  const pending = await prisma.signalRecord.findMany({ where: { outcome: null } });

  let updated = 0;
  for (const signal of pending) {
    const entryBar = await prisma.priceBar.findFirst({
      where: { tickerId: signal.tickerId, date: { lte: signal.createdAt } },
      orderBy: { date: "desc" },
    });
    // Bounded by targetDate -- without this, a hit registered weeks after the
    // real 7-day horizon would still count, quietly drifting from what "+7
    // days" is supposed to mean (caught while building the backtest, which
    // made the same mistake before this fix).
    const barsSince = await prisma.priceBar.findMany({
      where: { tickerId: signal.tickerId, date: { gt: signal.createdAt, lte: signal.targetDate } },
      orderBy: { date: "asc" },
    });

    const result = checkOutcome(
      signal.direction,
      signal.targetPrice ? Number(signal.targetPrice) : null,
      signal.stopLossPrice ? Number(signal.stopLossPrice) : null,
      entryBar ? Number(entryBar.close) : null,
      signal.targetDate,
      barsSince.map((b) => ({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close) })),
      new Date()
    );

    if (result.status !== "pending") {
      await prisma.signalRecord.update({
        where: { id: signal.id },
        data: { outcome: result.status, outcomeDetail: result.detail, outcomeCheckedAt: new Date() },
      });
      updated++;
    }
  }

  return { checked: pending.length, updated };
}

export interface HitRateSummary {
  counts: Record<string, number>;
  targetHitRate: number | null;
  targetStopEvaluated: number;
  directionAccuracy: number | null;
  directionOnlyEvaluated: number;
  totalEvaluated: number;
}

/**
 * Reports target-hit-rate and directional-accuracy as two SEPARATE numbers,
 * not blended into one -- actually hitting the suggested target is a
 * meaningfully stronger result than merely being directionally right when
 * neither level was reached, and conflating them would overstate accuracy.
 */
function summarizeOutcomes(outcomes: string[]): HitRateSummary {
  const counts: Record<string, number> = {};
  for (const o of outcomes) {
    counts[o] = (counts[o] ?? 0) + 1;
  }

  const targetStopEvaluated = (counts.hit_target ?? 0) + (counts.hit_stop ?? 0);
  const directionOnlyEvaluated = (counts.expired_direction_correct ?? 0) + (counts.expired_direction_wrong ?? 0);

  return {
    counts,
    targetHitRate: targetStopEvaluated > 0 ? Math.round(((counts.hit_target ?? 0) / targetStopEvaluated) * 100) : null,
    targetStopEvaluated,
    directionAccuracy:
      directionOnlyEvaluated > 0 ? Math.round(((counts.expired_direction_correct ?? 0) / directionOnlyEvaluated) * 100) : null,
    directionOnlyEvaluated,
    totalEvaluated: outcomes.length,
  };
}

export async function getHitRateSummary(): Promise<HitRateSummary> {
  const evaluated = await prisma.signalRecord.findMany({ where: { outcome: { not: null } } });
  return summarizeOutcomes(evaluated.map((s) => s.outcome!));
}

/** Same summary shape, but for backtest results (a separate table -- see BacktestSignal). */
export async function getBacktestHitRateSummary(): Promise<HitRateSummary> {
  const evaluated = await prisma.backtestSignal.findMany();
  return summarizeOutcomes(evaluated.map((s) => s.outcome));
}
