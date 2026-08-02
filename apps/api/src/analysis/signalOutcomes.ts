import { prisma } from "@financial-adviser/shared";

// Hit-rate summarising moved to packages/shared so the web dashboard and these
// scripts report identical numbers. Re-exported here so existing callers
// (run-backtest.ts, run-all.ts, check-outcomes.ts) keep their import path.
export {
  summarizeOutcomes,
  getHitRateSummary,
  getBacktestHitRateSummary,
  type HitRateSummary,
} from "@financial-adviser/shared";

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
  /**
   * The market day a target or stop was actually touched. Returned as real data
   * rather than left to be read back out of `detail` -- the distinct-episode
   * count behind every hit rate used to be recovered by regex over that prose.
   * Null for outcomes that never touched a level.
   */
  resolvedOn?: Date | null;
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
        resolvedOn: bar.date,
      };
    }
    if (hitTarget) {
      return {
        status: "hit_target",
        detail: `Target $${targetPrice} reached on ${dateStr} (high $${bar.high}).`,
        resolvedOn: bar.date,
      };
    }
    if (hitStop) {
      return {
        status: "hit_stop",
        detail: `Stop-loss $${stopLossPrice} reached on ${dateStr} (low $${bar.low}).`,
        resolvedOn: bar.date,
      };
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
    // Prefer the entry price captured when the signal was generated. Falling
    // back to a re-derived bar keeps pre-2026-08-02 rows gradeable, but the
    // stored value is what makes a grade reproducible.
    const entryBar = signal.entryPrice
      ? null
      : await prisma.priceBar.findFirst({
          where: { tickerId: signal.tickerId, date: { lte: signal.createdAt } },
          orderBy: { date: "desc" },
        });
    const entryPrice = signal.entryPrice ? Number(signal.entryPrice) : entryBar ? Number(entryBar.close) : null;
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
      entryPrice,
      signal.targetDate,
      barsSince.map((b) => ({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close) })),
      new Date()
    );

    if (result.status !== "pending") {
      await prisma.signalRecord.update({
        where: { id: signal.id },
        data: {
          outcome: result.status,
          outcomeDetail: result.detail,
          outcomeCheckedAt: new Date(),
          outcomeResolvedOn: result.resolvedOn ?? null,
        },
      });
      updated++;
    }
  }

  return { checked: pending.length, updated };
}

