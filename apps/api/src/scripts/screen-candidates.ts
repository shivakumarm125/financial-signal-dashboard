import "dotenv/config";
import { fetchDailyBars } from "../ingestion/twelvedata/priceClient";
import { getCikForSymbol } from "../ingestion/edgar/cikLookup";
import { getNewForm4Filings } from "../ingestion/edgar/submissionsClient";
import { fetchCompanyNews } from "../ingestion/finnhub/newsClient";

/**
 * Screens candidate tickers for whether THIS pipeline can say anything useful
 * about them, before committing any of them to the watchlist.
 *
 * Read-only by design: it never upserts a Ticker row. That matters because
 * run-all.ts (D1) runs the full pipeline against every Ticker that exists, so
 * ingesting a candidate is the same thing as enrolling it in the daily Claude
 * job. Screening has to happen outside the database.
 *
 * The three criteria come directly from real failures observed on AAPL:
 *
 *  1. RESOLUTION RATE — 9 of 10 AAPL backtest points graded `no_evaluation`,
 *     and the live 2026-07-31 signal scored 3% reachability. AAPL simply does
 *     not move far enough in 7 days for its own suggested targets to resolve.
 *     A ticker that never resolves produces no evidence, however good the
 *     analysis is. This is the dominant criterion.
 *
 *  2. INSIDER INDEPENDENCE — 10 AAPL backtest dates collapsed into 5 distinct
 *     insider-context states, because one Levinson sale sat in every 90-day
 *     lookback. Correlated inputs produce correlated signals, which look like
 *     many samples and behave like one.
 *
 *  3. NEWS DENSITY — thin coverage means the prompt leans on filings and
 *     technicals alone.
 *
 * None of this predicts returns, and it is not meant to. It measures whether a
 * ticker can generate gradeable, independent evidence — the precondition for
 * ever finding out whether this system has an edge.
 */

const HORIZON_DAYS = 7;
const INSIDER_LOOKBACK_DAYS = 90;

// Representative of the levels this system actually produces: AAPL's live
// signals set targets ~5-7% out and stops ~4-8% out. Not tuned per ticker --
// the point is to compare tickers against one fixed yardstick.
const TARGET_PCT = 0.05;
const STOP_PCT = 0.04;

interface Bar {
  date: Date;
  high: number;
  low: number;
  close: number;
}

interface ScreenRow {
  symbol: string;
  bars: number;
  medianExcursionPct: number;
  cleanResolveRate: number;
  ambiguousRate: number;
  unresolvedRate: number;
  targetFirstShare: number;
  reach3: number;
  reach5: number;
  reach8: number;
  form4Filings: number | null;
  insiderStates: number | null;
  insiderDates: number;
  newsPerDay: number | null;
  notes: string[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Rolling 7-day windows, replaying checkOutcome()'s exact grading logic against
 * a fixed +5%/-4% bullish setup.
 *
 * The naive metric — "did either level get touched" — rewards maximum
 * volatility, which is wrong. On a stock that swings 10% a week, both levels
 * get touched on the SAME daily bar, and checkOutcome can't tell which came
 * first from daily data, so it grades `ambiguous_same_day` and the signal
 * yields no evidence at all. Too quiet and nothing resolves; too wild and
 * everything resolves ambiguously. What matters is the CLEAN resolution rate
 * in between.
 */
function analysePrice(bars: Bar[]) {
  const excursions: number[] = [];
  let cleanTarget = 0;
  let cleanStop = 0;
  let ambiguous = 0;
  let unresolved = 0;
  let reach3 = 0;
  let reach5 = 0;
  let reach8 = 0;
  let windows = 0;

  for (let i = 0; i < bars.length; i++) {
    const start = bars[i];
    const end = new Date(start.date);
    end.setUTCDate(end.getUTCDate() + HORIZON_DAYS);
    const targetPrice = start.close * (1 + TARGET_PCT);
    const stopPrice = start.close * (1 - STOP_PCT);

    const window: Bar[] = [];
    for (let j = i + 1; j < bars.length; j++) {
      if (bars[j].date > end) break;
      window.push(bars[j]);
    }
    if (window.length === 0) continue;
    windows++;

    const maxHigh = Math.max(...window.map((b) => b.high));
    const minLow = Math.min(...window.map((b) => b.low));
    const up = (maxHigh - start.close) / start.close;
    const down = (start.close - minLow) / start.close;
    const excursion = Math.max(up, down);
    excursions.push(excursion);
    if (excursion >= 0.03) reach3++;
    if (excursion >= 0.05) reach5++;
    if (excursion >= 0.08) reach8++;

    // Same bar-by-bar walk checkOutcome does, same precedence.
    let settled = false;
    for (const bar of window) {
      const hitTarget = bar.high >= targetPrice;
      const hitStop = bar.low <= stopPrice;
      if (hitTarget && hitStop) {
        ambiguous++;
        settled = true;
        break;
      }
      if (hitTarget) {
        cleanTarget++;
        settled = true;
        break;
      }
      if (hitStop) {
        cleanStop++;
        settled = true;
        break;
      }
    }
    if (!settled) unresolved++;
  }

  const cleanResolved = cleanTarget + cleanStop;
  return {
    windows,
    medianExcursionPct: median(excursions),
    cleanResolveRate: windows ? cleanResolved / windows : 0,
    ambiguousRate: windows ? ambiguous / windows : 0,
    unresolvedRate: windows ? unresolved / windows : 0,
    targetFirstShare: cleanResolved ? cleanTarget / cleanResolved : 0,
    reach3: windows ? reach3 / windows : 0,
    reach5: windows ? reach5 / windows : 0,
    reach8: windows ? reach8 / windows : 0,
  };
}

/**
 * How many DISTINCT insider-context states would monthly-spaced backtest dates
 * see over the past year? 12 dates producing 12 states means genuinely
 * independent samples; 12 dates producing 3 states is AAPL's problem again.
 */
function analyseInsiderIndependence(filingDates: string[], monthlyDates: Date[]) {
  const fingerprints = new Set<string>();
  for (const d of monthlyDates) {
    const from = new Date(d);
    from.setUTCDate(from.getUTCDate() - INSIDER_LOOKBACK_DAYS);
    const inWindow = filingDates
      .filter((fd) => {
        const t = new Date(fd + "T00:00:00.000Z");
        return t >= from && t <= d;
      })
      .sort();
    fingerprints.add(inWindow.join(","));
  }
  return fingerprints.size;
}

function monthlyDatesBackFrom(latest: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(latest);
    d.setUTCMonth(d.getUTCMonth() - i);
    out.push(d);
  }
  return out.reverse();
}

async function screen(symbol: string): Promise<ScreenRow> {
  const notes: string[] = [];
  const row: ScreenRow = {
    symbol,
    bars: 0,
    medianExcursionPct: 0,
    cleanResolveRate: 0,
    ambiguousRate: 0,
    unresolvedRate: 0,
    targetFirstShare: 0,
    reach3: 0,
    reach5: 0,
    reach8: 0,
    form4Filings: null,
    insiderStates: null,
    insiderDates: 0,
    newsPerDay: null,
    notes,
  };

  // --- price ---
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const raw = await fetchDailyBars(symbol, start.toISOString().slice(0, 10));
  const bars: Bar[] = raw
    .map((b) => ({
      date: new Date(b.date + "T00:00:00.000Z"),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  row.bars = bars.length;
  if (bars.length < 200) {
    notes.push(`only ${bars.length} bars — too little history for MA200`);
  }
  const price = analysePrice(bars);
  row.medianExcursionPct = price.medianExcursionPct;
  row.cleanResolveRate = price.cleanResolveRate;
  row.ambiguousRate = price.ambiguousRate;
  row.unresolvedRate = price.unresolvedRate;
  row.targetFirstShare = price.targetFirstShare;
  row.reach3 = price.reach3;
  row.reach5 = price.reach5;
  row.reach8 = price.reach8;

  // --- insider filings (dates only; no document parsing, so this stays cheap) ---
  try {
    const cik = await getCikForSymbol(symbol);
    if (!cik) {
      notes.push("no CIK found — SEC filings unavailable");
    } else {
      const filings = await getNewForm4Filings(cik.cik, null);
      const yearAgo = new Date();
      yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
      const recent = filings.map((f) => f.filingDate).filter((d) => new Date(d + "T00:00:00.000Z") >= yearAgo);
      row.form4Filings = recent.length;

      const latestBarDate = bars.length ? bars[bars.length - 1].date : new Date();
      const monthly = monthlyDatesBackFrom(latestBarDate, 12);
      row.insiderDates = monthly.length;
      row.insiderStates = analyseInsiderIndependence(recent, monthly);
    }
  } catch (e) {
    notes.push(`filings lookup failed: ${(e as Error).message}`);
  }

  // --- news density ---
  try {
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 14);
    const articles = await fetchCompanyNews(symbol, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    row.newsPerDay = articles.length / 14;
  } catch (e) {
    notes.push(`news lookup failed: ${(e as Error).message}`);
  }

  return row;
}

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run screen:candidates --workspace=@financial-adviser/api -- MSFT NVDA ...");
    process.exit(1);
  }

  console.log(
    `[Screen] ${symbols.length} candidate(s). Read-only — no Ticker rows created, no Claude calls.\n` +
      `[Screen] Yardstick: +${TARGET_PCT * 100}% target / -${STOP_PCT * 100}% stop over ${HORIZON_DAYS} days.\n`
  );

  const rows: ScreenRow[] = [];
  for (const s of symbols) {
    process.stdout.write(`[Screen] ${s} ... `);
    try {
      const row = await screen(s);
      rows.push(row);
      console.log(
        `clean ${pct(row.cleanResolveRate)}, ambiguous ${pct(row.ambiguousRate)}, ` +
          `median move ${pct(row.medianExcursionPct)}, ` +
          `insider states ${row.insiderStates ?? "?"}/${row.insiderDates}, news/day ${row.newsPerDay?.toFixed(1) ?? "?"}`
      );
    } catch (e) {
      console.log(`FAILED — ${(e as Error).message}`);
    }
  }

  rows.sort((a, b) => b.cleanResolveRate - a.cleanResolveRate);

  console.log("\n=== RANKED (by CLEAN resolve rate — windows that yield usable evidence) ===");
  console.log(
    "SYM    bars  medMove   clean   ambig  unres  tgtFirst   >=8%   form4/yr  states/12  news/day"
  );
  for (const r of rows) {
    console.log(
      `${r.symbol.padEnd(6)} ${String(r.bars).padStart(4)}  ` +
        `${pct(r.medianExcursionPct).padStart(6)}  ${pct(r.cleanResolveRate).padStart(6)}  ` +
        `${pct(r.ambiguousRate).padStart(5)}  ${pct(r.unresolvedRate).padStart(5)}  ` +
        `${pct(r.targetFirstShare).padStart(7)}  ${pct(r.reach8).padStart(6)}  ` +
        `${String(r.form4Filings ?? "?").padStart(7)}  ${String(r.insiderStates ?? "?").padStart(8)}  ` +
        `${(r.newsPerDay?.toFixed(1) ?? "?").padStart(8)}`
    );
    for (const n of r.notes) console.log(`       note: ${n}`);
  }

  console.log(
    "\n[Screen] clean  = windows where exactly one level was touched first -> a gradeable outcome."
  );
  console.log(
    "[Screen] ambig  = both levels touched on the SAME daily bar -> checkOutcome grades ambiguous_same_day, no evidence."
  );
  console.log("[Screen] unres  = neither level touched -> falls back to the weaker direction-only metric.");
  console.log(
    "[Screen] tgtFirst = of clean resolutions, share that hit the +5% target rather than the -4% stop. This is the"
  );
  console.log(
    "[Screen]            BASE RATE a signal must beat to show skill -- a high number here means easy-looking hit rates."
  );
  console.log(
    "[Screen] states/12 = distinct insider-context states across 12 monthly backtest dates. Higher = more independent samples."
  );
  console.log("[Screen] None of these columns predict returns. They measure whether evidence can be generated at all.");
}

main().catch((err) => {
  console.error("[Screen] Fatal error:", err);
  process.exit(1);
});
