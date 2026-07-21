import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { runBacktest } from "../backtest/runBacktest";
import { getBacktestHitRateSummary } from "../analysis/signalOutcomes";

function weeklyDatesBackFrom(latest: Date, count: number): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(latest);
    d.setUTCDate(d.getUTCDate() - i * 7);
    dates.push(d);
  }
  return dates.reverse(); // oldest first
}

async function main() {
  const symbol = process.argv[2] ?? "AAPL";
  const count = Number(process.argv[3] ?? 10);

  // Latest safe candidate: 7 days before the most recent stored price bar,
  // so there's real subsequent data to grade against. Infeasible candidates
  // (not enough prior history for MA200, etc.) are skipped, not guessed at.
  const latestBar = await prisma.priceBar.findFirst({
    where: { ticker: { symbol: symbol.toUpperCase() } },
    orderBy: { date: "desc" },
  });
  if (!latestBar) {
    console.error(`[Backtest] No price data for ${symbol} -- ingest first.`);
    process.exit(1);
  }
  const latestSafeDate = new Date(latestBar.date);
  latestSafeDate.setUTCDate(latestSafeDate.getUTCDate() - 7);

  const candidates = weeklyDatesBackFrom(latestSafeDate, count);
  console.log(`[Backtest] Running ${candidates.length} weekly point(s) for ${symbol}, ending ${candidates[candidates.length - 1].toISOString().slice(0, 10)}`);

  const results = await runBacktest(symbol, candidates);

  let ok = 0;
  let skipped = 0;
  let errored = 0;
  for (const r of results) {
    console.log(`[Backtest] ${r.asOfDate}: ${r.status}${r.reason ? " -- " + r.reason : ""}`);
    if (r.status === "ok") ok++;
    else if (r.status === "skipped") skipped++;
    else errored++;
  }

  console.log(`\n[Backtest] ${ok} run, ${skipped} skipped (infeasible), ${errored} errored.`);

  const summary = await getBacktestHitRateSummary();
  console.log("\n[Backtest] Hit-rate summary (backtest results only, separate from live signals):");
  console.log(`  Target/stop outcomes: ${summary.targetStopEvaluated} evaluated -- target hit rate: ${summary.targetHitRate ?? "n/a"}%`);
  console.log(`  Direction-only outcomes: ${summary.directionOnlyEvaluated} evaluated -- direction accuracy: ${summary.directionAccuracy ?? "n/a"}%`);
  console.log(`  Breakdown: ${JSON.stringify(summary.counts)}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[Backtest] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
