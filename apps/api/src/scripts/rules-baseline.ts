import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { checkOutcome, OutcomeBar } from "../analysis/signalOutcomes";
import { Bar } from "../ingestion/twelvedata/technicals";
import {
  ruleDirection,
  averageTrueRange,
  levelsFor,
  Direction,
  FilingLite,
  HORIZON_DAYS,
} from "../baseline/rulesBaseline";

/**
 * Compares Claude's signals with a free rules-only baseline (see
 * baseline/rulesBaseline.ts). Read-only: writes nothing, calls no paid API.
 *
 *   npm run baseline:rules
 *
 * Two views:
 * 1. Head-to-head on every graded Claude signal (live + backtest). The rule's
 *    direction is given Claude's OWN target/stop distances, so the only thing
 *    that differs is the direction call. Hit-first rate depends heavily on how
 *    far the levels sit, so comparing different-sized levels would measure
 *    level placement, not judgement. "Always bullish/bearish" with the same
 *    distances are the base rates any call has to beat.
 * 2. The rule on its own over the whole price history (weekly points, levels
 *    at 1 ATR each way), for a sample far larger than Claude's.
 */

interface TickerData {
  symbol: string;
  bars: Bar[];
  filings: FilingLite[];
  earningsDates: Date[];
}

interface Tally {
  target: number;
  stop: number;
  ambiguous: number;
  expiredRight: number;
  expiredWrong: number;
  abstain: number;
}

const emptyTally = (): Tally => ({ target: 0, stop: 0, ambiguous: 0, expiredRight: 0, expiredWrong: 0, abstain: 0 });

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

function record(t: Tally, status: string): void {
  if (status === "hit_target") t.target++;
  else if (status === "hit_stop") t.stop++;
  else if (status === "ambiguous_same_day") t.ambiguous++;
  else if (status === "expired_direction_correct") t.expiredRight++;
  else if (status === "expired_direction_wrong") t.expiredWrong++;
  else t.abstain++;
}

/** 95% Wilson interval -- honest about how little a small sample says. */
function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function fmt(label: string, t: Tally): string {
  const resolved = t.target + t.stop;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const rate = resolved ? `${pct(t.target / resolved)} (95% CI ${wilson(t.target, resolved).map(pct).join("-")})` : "n/a";
  const expired = t.expiredRight + t.expiredWrong;
  return (
    `  ${label.padEnd(34)} target-first ${String(t.target).padStart(3)}/${String(resolved).padEnd(3)} = ${rate.padEnd(26)}` +
    ` | expired dir. right ${t.expiredRight}/${expired} | same-day ${t.ambiguous} | no call ${t.abstain}`
  );
}

function barsBetween(bars: Bar[], afterExclusive: Date, toInclusive: Date): OutcomeBar[] {
  return bars
    .filter((b) => b.date > afterExclusive && b.date <= toInclusive)
    .map((b) => ({ date: b.date, high: b.high, low: b.low, close: b.close }));
}

function barsUpTo(bars: Bar[], asOf: Date): Bar[] {
  let end = 0;
  while (end < bars.length && bars[end].date <= asOf) end++;
  return bars.slice(0, end);
}

function grade(direction: Direction, target: number | null, stop: number | null, entry: number, horizonEnd: Date, bars: OutcomeBar[]): string {
  return checkOutcome(direction, target, stop, entry, horizonEnd, bars, new Date()).status;
}

async function loadTicker(id: string, symbol: string): Promise<TickerData> {
  const [bars, filings, earnings] = await Promise.all([
    prisma.priceBar.findMany({ where: { tickerId: id }, orderBy: { date: "asc" } }),
    prisma.insiderFiling.findMany({
      where: { tickerId: id },
      select: { transactionDate: true, filedAt: true, transactionCode: true },
    }),
    prisma.earningsEvent.findMany({ where: { tickerId: id }, select: { date: true } }),
  ]);
  return {
    symbol,
    bars: bars.map((b) => ({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) })),
    filings,
    earningsDates: earnings.map((e) => e.date),
  };
}

async function main() {
  const tickers = await prisma.ticker.findMany({ orderBy: { symbol: "asc" } });
  const data = new Map<string, TickerData>();
  for (const t of tickers) data.set(t.id, await loadTicker(t.id, t.symbol));

  // --- 1. Head-to-head on Claude's graded signals ---------------------------
  const live = await prisma.signalRecord.findMany({ where: { outcome: { not: null } } });
  const backtest = await prisma.backtestSignal.findMany();
  const points = [
    ...live.map((s) => ({ source: "live", tickerId: s.tickerId, asOf: s.createdAt, horizonEnd: s.targetDate, s })),
    ...backtest.map((s) => ({ source: "backtest", tickerId: s.tickerId, asOf: s.asOfDate, horizonEnd: addDays(s.asOfDate, HORIZON_DAYS), s })),
  ];

  const claude = emptyTally();
  const rule = emptyTally();
  const alwaysBull = emptyTally();
  const alwaysBear = emptyTally();
  const whenAgree = emptyTally();
  const whenDisagree = emptyTally();
  const ruleOnClaudeNeutral = emptyTally();
  let claudeNeutral = 0;

  for (const p of points) {
    const d = data.get(p.tickerId);
    if (!d) continue;
    const toDate = barsUpTo(d.bars, p.asOf);
    const entry = p.s.entryPrice ? Number(p.s.entryPrice) : toDate.at(-1)?.close;
    if (entry === undefined) continue;
    const future = barsBetween(d.bars, p.asOf, p.horizonEnd);
    if (future.length === 0) continue;

    const decision = ruleDirection({ barsToDate: toDate, filings: d.filings, earningsDates: d.earningsDates, asOf: p.asOf });
    const cDir = p.s.direction as Direction;
    const cTarget = p.s.targetPrice ? Number(p.s.targetPrice) : null;
    const cStop = p.s.stopLossPrice ? Number(p.s.stopLossPrice) : null;

    if (cDir === "neutral" || cTarget === null || cStop === null) {
      // Claude sat out. Grade the rule with its own ATR levels, so neutral
      // days aren't silently dropped from the picture.
      claudeNeutral++;
      const atr = averageTrueRange(toDate);
      if (decision.direction === "neutral" || atr === null) {
        ruleOnClaudeNeutral.abstain++;
      } else {
        const lv = levelsFor(decision.direction, entry, atr, atr);
        record(ruleOnClaudeNeutral, grade(decision.direction, lv.target, lv.stop, entry, p.horizonEnd, future));
      }
      continue;
    }

    // Same distances for every contender: only the direction differs.
    const tDist = Math.abs(cTarget - entry);
    const sDist = Math.abs(cStop - entry);
    const run = (dir: Direction) => {
      const lv = levelsFor(dir, entry, tDist, sDist);
      return grade(dir, lv.target, lv.stop, entry, p.horizonEnd, future);
    };

    const claudeStatus = run(cDir);
    record(claude, claudeStatus);
    record(alwaysBull, run("bullish"));
    record(alwaysBear, run("bearish"));
    if (decision.direction === "neutral") {
      rule.abstain++;
    } else {
      record(rule, run(decision.direction));
      record(decision.direction === cDir ? whenAgree : whenDisagree, claudeStatus);
    }
  }

  const directional = claude.target + claude.stop + claude.ambiguous + claude.expiredRight + claude.expiredWrong + claude.abstain;
  console.log(`\n=== 1. Head-to-head on Claude's graded signals (${live.length} live + ${backtest.length} backtest) ===`);
  console.log(`  ${directional} directional Claude calls with levels; ${claudeNeutral} neutral calls (Claude sat out).`);
  console.log("  Every row below uses Claude's own target/stop distances -- only the direction differs.\n");
  console.log(fmt("Claude", claude));
  console.log(fmt("Rules baseline", rule));
  console.log(fmt("Always bullish", alwaysBull));
  console.log(fmt("Always bearish", alwaysBear));
  console.log("");
  console.log(fmt("Claude, where rule agreed", whenAgree));
  console.log(fmt("Claude, where rule disagreed", whenDisagree));
  console.log(fmt("Rule on Claude's neutral days*", ruleOnClaudeNeutral));
  console.log("  * graded with the rule's own levels (1 ATR each way), since Claude set none.");

  // --- 2. The rule alone over the whole history -----------------------------
  const ruleAll = emptyTally();
  const bullAll = emptyTally();
  const perTicker: string[] = [];
  let points2 = 0;
  for (const d of data.values()) {
    const t = emptyTally();
    const lastBarDate = d.bars.at(-1)?.date;
    if (!lastBarDate) continue;
    // Weekly points: consecutive days share almost all inputs and outcomes,
    // so daily points would inflate the sample without adding evidence (B9).
    for (let i = 199; i < d.bars.length; i += 5) {
      const asOf = d.bars[i].date;
      const horizonEnd = addDays(asOf, HORIZON_DAYS);
      if (horizonEnd > lastBarDate) break;
      const toDate = d.bars.slice(0, i + 1);
      const atr = averageTrueRange(toDate);
      if (atr === null) continue;
      const entry = d.bars[i].close;
      const future = barsBetween(d.bars, asOf, horizonEnd);
      points2++;

      const decision = ruleDirection({ barsToDate: toDate, filings: d.filings, earningsDates: d.earningsDates, asOf });
      if (decision.direction === "neutral") {
        ruleAll.abstain++;
        t.abstain++;
      } else {
        const lv = levelsFor(decision.direction, entry, atr, atr);
        const status = grade(decision.direction, lv.target, lv.stop, entry, horizonEnd, future);
        record(ruleAll, status);
        record(t, status);
      }
      const bl = levelsFor("bullish", entry, atr, atr);
      record(bullAll, grade("bullish", bl.target, bl.stop, entry, horizonEnd, future));
    }
    perTicker.push(fmt(`  ${d.symbol}`, t));
  }

  console.log(`\n=== 2. Rules baseline alone, whole price history (${points2} weekly points, levels 1 ATR each way) ===`);
  console.log("  Symmetric levels, so a call with no skill sits near 50%.\n");
  console.log(fmt("Rules baseline", ruleAll));
  console.log(fmt("Always bullish", bullAll));
  for (const line of perTicker) console.log(line);
  console.log("");
}

main()
  .catch((err) => {
    console.error("[Baseline] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
