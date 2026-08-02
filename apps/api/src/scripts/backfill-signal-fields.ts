import "dotenv/config";
import { prisma } from "@financial-adviser/shared";

/**
 * One-off backfill for the two columns added on 2026-08-02.
 *
 * `entryPrice` is reconstructed the same way the outcome checker used to derive
 * it -- the last daily close at or before the signal's creation -- so existing
 * grades stay exactly as they were rather than shifting under a new rule.
 *
 * `outcomeResolvedOn` is parsed out of `outcomeDetail`, which is the mechanism
 * being retired. Running this while only ~16 signals exist is deliberate: at
 * five a day the reconstruction gets both slower and less trustworthy, since
 * price bars can be revised after the fact.
 *
 * Idempotent -- only touches rows where the column is still null. Pass --dry to
 * see what it would do without writing.
 */

const DRY = process.argv.includes("--dry");

function parseResolvedOn(detail: string | null): Date | null {
  const match = detail?.match(/on (\d{4}-\d{2}-\d{2})/);
  return match ? new Date(match[1] + "T00:00:00.000Z") : null;
}

async function main() {
  console.log(DRY ? "DRY RUN -- no writes\n" : "backfilling\n");

  const signals = await prisma.signalRecord.findMany({ include: { ticker: true }, orderBy: { createdAt: "asc" } });

  let entryFilled = 0;
  let entryMissing = 0;
  let resolvedFilled = 0;

  for (const s of signals) {
    const updates: { entryPrice?: number; outcomeResolvedOn?: Date } = {};

    if (s.entryPrice === null) {
      const bar = await prisma.priceBar.findFirst({
        where: { tickerId: s.tickerId, date: { lte: s.createdAt } },
        orderBy: { date: "desc" },
      });
      if (bar) {
        updates.entryPrice = Number(bar.close);
        entryFilled++;
      } else {
        entryMissing++;
        console.log(`  ${s.ticker.symbol} ${s.createdAt.toISOString().slice(0, 10)}: no prior price bar, entryPrice left null`);
      }
    }

    if (s.outcomeResolvedOn === null) {
      const resolved = parseResolvedOn(s.outcomeDetail);
      if (resolved) {
        updates.outcomeResolvedOn = resolved;
        resolvedFilled++;
      }
    }

    if (Object.keys(updates).length > 0) {
      console.log(
        `  ${s.ticker.symbol} ${s.createdAt.toISOString().slice(0, 10)} ${s.direction.padEnd(7)} ` +
          `entry=${updates.entryPrice ?? "(kept)"} resolvedOn=${updates.outcomeResolvedOn?.toISOString().slice(0, 10) ?? "(none)"}`
      );
      if (!DRY) await prisma.signalRecord.update({ where: { id: s.id }, data: updates });
    }
  }

  const backtests = await prisma.backtestSignal.findMany({ where: { outcomeResolvedOn: null } });
  let backtestFilled = 0;
  for (const b of backtests) {
    const resolved = parseResolvedOn(b.outcomeDetail);
    if (!resolved) continue;
    if (!DRY) await prisma.backtestSignal.update({ where: { id: b.id }, data: { outcomeResolvedOn: resolved } });
    backtestFilled++;
  }

  console.log(
    `\nsignals: ${signals.length} scanned, entryPrice filled ${entryFilled} (${entryMissing} had no bar), ` +
      `outcomeResolvedOn filled ${resolvedFilled}`
  );
  console.log(`backtests: outcomeResolvedOn filled ${backtestFilled}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
