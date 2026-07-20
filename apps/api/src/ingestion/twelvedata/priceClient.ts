import { twelveDataFetch } from "./httpClient";
import { TWELVE_DATA_API_KEY, TWELVE_DATA_BASE_URL } from "./config";

export interface RawBar {
  date: string; // "YYYY-MM-DD"
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface TimeSeriesSuccess {
  meta: { symbol: string; interval: string };
  values: { datetime: string; open: string; high: string; low: string; close: string; volume: string }[];
  status: "ok";
}

interface TimeSeriesError {
  code: number;
  message: string;
  status: "error";
}

/**
 * Fetches daily bars for one symbol from `startDate` (inclusive) to today.
 * One HTTP request = one unit of Twelve Data quota, regardless of how many
 * bars come back -- this is why both the initial 1-year backfill and every
 * incremental sync go through this same function with just a different
 * startDate, rather than separate "backfill" vs "sync" API calls.
 */
export async function fetchDailyBars(symbol: string, startDate: string): Promise<RawBar[]> {
  const url =
    `${TWELVE_DATA_BASE_URL}/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=1day&start_date=${startDate}&order=ASC&apikey=${TWELVE_DATA_API_KEY}`;

  const res = await twelveDataFetch(url);
  const data = (await res.json()) as TimeSeriesSuccess | TimeSeriesError;

  if (data.status === "error") {
    throw new Error(`Twelve Data error for ${symbol}: ${data.message}`);
  }

  return data.values.map((v) => ({
    date: v.datetime,
    open: v.open,
    high: v.high,
    low: v.low,
    close: v.close,
    volume: v.volume,
  }));
}
