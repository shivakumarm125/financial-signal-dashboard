import { prisma } from "@financial-adviser/shared";
import { fetchDailyBars } from "./priceClient";
import { computeTechnicals, Technicals } from "./technicals";
import { BACKFILL_DAYS } from "./config";

export interface TickerPriceResult {
  symbol: string;
  status: "ok" | "error";
  barsStored: number;
  technicals?: Technicals;
  error?: string;
}

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ingests daily price bars for one ticker: on first run, backfills BACKFILL_DAYS
 * (1 year, Q2) from Twelve Data; on later runs, only requests bars since the
 * last stored date. Either way this is exactly ONE Twelve Data API call --
 * quota is far too scarce (8/min, 800/day) to spend more than that per ticker.
 */
export async function ingestPricesForTicker(symbol: string): Promise<TickerPriceResult> {
  const ticker = await prisma.ticker.upsert({
    where: { symbol: symbol.toUpperCase() },
    update: {},
    create: { symbol: symbol.toUpperCase() },
    include: { priceIngestionState: true },
  });

  try {
    let startDate: Date;
    if (ticker.priceIngestionState?.lastBarDate) {
      startDate = new Date(ticker.priceIngestionState.lastBarDate);
      startDate.setUTCDate(startDate.getUTCDate() + 1);
    } else {
      startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - BACKFILL_DAYS);
    }

    const today = toDateOnly(new Date());
    if (startDate > today) {
      // Already synced today; nothing new to fetch, don't spend a call.
      return { symbol, status: "ok", barsStored: 0 };
    }

    const bars = await fetchDailyBars(symbol, formatDate(startDate));

    for (const bar of bars) {
      await prisma.priceBar.upsert({
        where: { tickerId_date: { tickerId: ticker.id, date: new Date(bar.date) } },
        update: {},
        create: {
          tickerId: ticker.id,
          date: new Date(bar.date),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: BigInt(Math.round(Number(bar.volume))),
        },
      });
    }

    if (bars.length > 0) {
      const latestDate = new Date(bars[bars.length - 1].date);
      await prisma.priceIngestionState.upsert({
        where: { tickerId: ticker.id },
        update: { lastBarDate: latestDate },
        create: { tickerId: ticker.id, lastBarDate: latestDate },
      });
    }

    const technicals = await getStoredTechnicals(ticker.id);

    return { symbol, status: "ok", barsStored: bars.length, technicals };
  } catch (err) {
    return {
      symbol,
      status: "error",
      barsStored: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Computes technicals on demand from whatever bars are already stored -- no
 * separate persisted snapshot to keep in sync. `asOfDate` (default: now)
 * restricts to bars up to that date -- critical for backtesting, where using
 * bars after the simulated date would be lookahead bias (the "signal" would
 * see the future it's supposedly being graded against).
 */
export async function getStoredTechnicals(tickerId: string, asOfDate: Date = new Date()): Promise<Technicals> {
  const rows = await prisma.priceBar.findMany({
    where: { tickerId, date: { lte: asOfDate } },
    orderBy: { date: "asc" },
  });

  return computeTechnicals(
    rows.map((r) => ({
      date: r.date,
      close: Number(r.close),
      high: Number(r.high),
      low: Number(r.low),
      volume: Number(r.volume),
    }))
  );
}

export async function ingestPrices(symbols: string[]): Promise<TickerPriceResult[]> {
  const results: TickerPriceResult[] = [];
  for (const symbol of symbols) {
    results.push(await ingestPricesForTicker(symbol));
  }
  return results;
}
