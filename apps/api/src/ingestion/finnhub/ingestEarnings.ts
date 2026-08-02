import { prisma } from "@financial-adviser/shared";
import { fetchEarningsCalendar } from "./earningsClient";

export interface EarningsIngestResult {
  symbol: string;
  status: "ok" | "error";
  eventsStored: number;
  nextEarnings: string | null;
  error?: string;
}

// Past window gives the model recent-report context; forward window must comfortably
// exceed the 7-day signal horizon so an upcoming print is never a surprise.
const LOOKBACK_DAYS = 120;
const LOOKAHEAD_DAYS = 120;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ingests scheduled + reported earnings dates for one ticker (B10).
 *
 * Unlike news/prices there's no incremental pointer: the window is small, the
 * endpoint is cheap, and scheduled dates get REVISED (a company moves its
 * report date, or an estimate firms up). A plain re-upsert of the whole window
 * each run is both simpler and more correct than trying to sync incrementally.
 */
export async function ingestEarningsForTicker(symbol: string): Promise<EarningsIngestResult> {
  const ticker = await prisma.ticker.upsert({
    where: { symbol: symbol.toUpperCase() },
    update: {},
    create: { symbol: symbol.toUpperCase() },
  });

  try {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + LOOKAHEAD_DAYS);

    const events = await fetchEarningsCalendar(symbol, ymd(from), ymd(to));

    for (const e of events) {
      const data = {
        hour: e.hour,
        quarter: e.quarter,
        year: e.year,
        epsEstimate: e.epsEstimate,
        epsActual: e.epsActual,
        revenueEstimate: e.revenueEstimate,
        revenueActual: e.revenueActual,
      };
      await prisma.earningsEvent.upsert({
        where: { tickerId_date: { tickerId: ticker.id, date: e.date } },
        update: data,
        create: { tickerId: ticker.id, date: e.date, ...data },
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const next = await prisma.earningsEvent.findFirst({
      where: { tickerId: ticker.id, date: { gte: today } },
      orderBy: { date: "asc" },
    });

    return {
      symbol,
      status: "ok",
      eventsStored: events.length,
      nextEarnings: next ? ymd(next.date) : null,
    };
  } catch (err) {
    return {
      symbol,
      status: "error",
      eventsStored: 0,
      nextEarnings: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ingests earnings for a list of tickers. One ticker's failure doesn't stop the rest. */
export async function ingestEarnings(symbols: string[]): Promise<EarningsIngestResult[]> {
  const results: EarningsIngestResult[] = [];
  for (const symbol of symbols) {
    results.push(await ingestEarningsForTicker(symbol));
  }
  return results;
}
