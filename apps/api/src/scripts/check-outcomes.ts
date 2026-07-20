import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { checkAllPendingOutcomes, getHitRateSummary } from "../analysis/signalOutcomes";

async function main() {
  const result = await checkAllPendingOutcomes();
  console.log(`[C5] Checked ${result.checked} pending signal(s), ${result.updated} now have a terminal outcome.`);

  const summary = await getHitRateSummary();
  console.log("\n[C5] Hit-rate summary:");
  console.log(`  Target/stop outcomes: ${summary.targetStopEvaluated} evaluated -- target hit rate: ${summary.targetHitRate ?? "n/a"}%`);
  console.log(`  Direction-only outcomes (7 days passed, no level hit): ${summary.directionOnlyEvaluated} evaluated -- direction accuracy: ${summary.directionAccuracy ?? "n/a"}%`);
  console.log(`  Breakdown: ${JSON.stringify(summary.counts)}`);
  if (summary.totalEvaluated < 30) {
    console.log(`  NOTE: only ${summary.totalEvaluated} signal(s) evaluated so far -- not enough data for a statistically meaningful rate.`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[C5] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
