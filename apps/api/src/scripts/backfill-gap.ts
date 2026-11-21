import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { prepareBacktestPoints, runPreparedBacktest, BacktestPoint } from "../backtest/runBacktest";
import { countPromptTokens } from "../analysis/claudeClient";
import { estimateCostUsd } from "../analysis/usageRecording";
import { getBacktestHitRateSummary } from "../analysis/signalOutcomes";

/**
 * Fills a stretch of days the live pipeline missed (e.g. the 2026-09-16 to
 * 2026-11-19 dead-key outage) with as-of-date backtest signals.
 *
 * Results go to BacktestSignal, never SignalRecord: they were produced after
 * the fact, and mixing them into the live track record would overstate what
 * the system actually told anyone at the time.
 *
 * Dry run by default -- prices the run with the free countTokens API and
 * spends nothing. Pass --confirm to actually submit the batch.
 *
 *   npm run backfill:gap -- [--from 2026-09-16] [--to 2026-11-12] [--every 7]
 *                           [--symbols AAPL,AMD] [--max-cost 0.50] [--confirm]
 *
 * Defaults: the most recent stretch of more than a week with no live signals,
 * capped at the last date whose full 7-day horizon has known prices, one
 * point per ticker every 7 days --
 * daily points would mostly re-read the same filings and news, so they cost
 * more without being independent evidence (see B9).
 */

const HORIZON_DAYS = 7;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

// Longer than any normal pause (weekends, the Mon/Wed/Fri schedule), so only
// a real outage counts as a gap.
const MIN_GAP_DAYS = 7;

/**
 * The most recent stretch with no live signals for longer than MIN_GAP_DAYS --
 * found from the data rather than "since the last signal", because once the
 * pipeline recovers the last signal is recent and the outage lies behind it.
 * With no such gap, falls back to everything after the last signal.
 */
async function findLatestGap(latestBarDate: Date): Promise<{ from: Date; to: Date }> {
  const signals = await prisma.signalRecord.findMany({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const days = [...new Set(signals.map((s) => day(s.createdAt)))].map((d) => new Date(`${d}T00:00:00Z`));
  for (let i = 0; i + 1 < days.length; i++) {
    const [newer, older] = [days[i], days[i + 1]];
    if ((newer.getTime() - older.getTime()) / 86_400_000 > MIN_GAP_DAYS) {
      return { from: addDays(older, 1), to: addDays(newer, -1) };
    }
  }
  return { from: days.length ? addDays(days[0], 1) : latestBarDate, to: latestBarDate };
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const every = Number(arg("every") ?? 7);
  const maxCost = arg("max-cost") ? Number(arg("max-cost")) : undefined;

  const symbols = arg("symbols")
    ? arg("symbols")!.split(",").map((s) => s.trim().toUpperCase())
    : (await prisma.ticker.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } })).map((t) => t.symbol);

  const latestBar = await prisma.priceBar.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  if (!latestBar) throw new Error("No price data at all -- nothing to backfill against.");

  const gap = await findLatestGap(latestBar.date);
  const from = arg("from") ? new Date(`${arg("from")}T00:00:00Z`) : gap.from;
  let to = arg("to") ? new Date(`${arg("to")}T00:00:00Z`) : gap.to;
  // A point is only gradeable once its whole 7-day horizon has known prices.
  const lastGradeable = addDays(latestBar.date, -HORIZON_DAYS);
  if (to > lastGradeable) to = lastGradeable;

  const dates: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, every)) dates.push(d);

  // Never pay twice for a point that already exists.
  const existing = await prisma.backtestSignal.findMany({
    where: { ticker: { symbol: { in: symbols } }, asOfDate: { in: dates } },
    select: { asOfDate: true, ticker: { select: { symbol: true } } },
  });
  const done = new Set(existing.map((e) => `${e.ticker.symbol}|${e.asOfDate.getTime()}`));
  const points: BacktestPoint[] = [];
  for (const asOfDate of dates) {
    for (const symbol of symbols) if (!done.has(`${symbol}|${asOfDate.getTime()}`)) points.push({ symbol, asOfDate });
  }

  console.log(`[Backfill] ${day(from)} -> ${day(to)}, every ${every} day(s): ${dates.map(day).join(", ")}`);
  console.log(`[Backfill] ${points.length} point(s) to generate across ${symbols.join(", ")} (${done.size} already done, skipped).`);
  if (points.length === 0) return;

  const { prepared, unusable } = await prepareBacktestPoints(points);
  for (const u of unusable) console.log(`[Backfill] ${u.symbol} ${u.result.asOfDate}: ${u.result.status} -- ${u.result.reason}`);

  // Price it: real input tokens (free count), output from this system's own
  // recent average, since thinking makes output length the larger cost.
  const recent = await prisma.usageRecord.findMany({ where: { purpose: "signal" }, orderBy: { createdAt: "desc" }, take: 25 });
  const avgOutput = recent.length ? Math.round(recent.reduce((s, r) => s + r.outputTokens, 0) / recent.length) : 1500;
  let inputTokens = 0;
  for (const p of prepared) inputTokens += await countPromptTokens(p.context.promptText);
  const estimate = estimateCostUsd({ inputTokens, outputTokens: avgOutput * prepared.length }, new Date(), { batch: true });

  console.log(
    `[Backfill] Estimated cost (Batch, half price): $${estimate.toFixed(3)} for ${prepared.length} call(s) ` +
      `(${inputTokens.toLocaleString()} input tokens counted, ~${avgOutput} output each). ` +
      `Validation retries, if any, add a little on top.`
  );

  if (maxCost !== undefined && estimate > maxCost) {
    console.log(`[Backfill] Estimate exceeds --max-cost $${maxCost}; not submitting. Use --every or --symbols to shrink it.`);
    return;
  }
  if (!confirm) {
    console.log("[Backfill] Dry run -- nothing spent. Re-run with --confirm to submit.");
    return;
  }

  const ran = await runPreparedBacktest(prepared);
  for (const r of ran) console.log(`[Backfill] ${r.symbol} ${r.result.asOfDate}: ${r.result.status}${r.result.reason ? " -- " + r.result.reason : ""}`);

  const spent = await prisma.usageRecord.aggregate({
    where: { purpose: "backtest", createdAt: { gte: addDays(new Date(), -1) } },
    _sum: { estimatedCostUsd: true },
  });
  console.log(`[Backfill] Recorded backtest spend in the last 24h: $${Number(spent._sum.estimatedCostUsd ?? 0).toFixed(3)}`);

  const summary = await getBacktestHitRateSummary();
  console.log("\n[Backfill] Hit-rate summary (all backtest results, separate from live signals):");
  console.log(`  Target/stop outcomes: ${summary.targetStopEvaluated} evaluated -- target hit rate: ${summary.targetHitRate ?? "n/a"}%`);
  console.log(`  Direction-only outcomes: ${summary.directionOnlyEvaluated} evaluated -- direction accuracy: ${summary.directionAccuracy ?? "n/a"}%`);
  console.log(`  Breakdown: ${JSON.stringify(summary.counts)}`);
}

main()
  .catch((err) => {
    console.error("[Backfill] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
