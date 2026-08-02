import { finnhubFetch } from "./httpClient";
import { FINNHUB_API_KEY, FINNHUB_BASE_URL } from "./config";

export interface RawEarnings {
  date: Date;
  hour: string | null;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: bigint | null;
  revenueActual: bigint | null;
}

interface FinnhubEarnings {
  date: string; // "YYYY-MM-DD"
  hour?: string; // "bmo" | "amc" | "dmh" | ""
  quarter?: number;
  year?: number;
  epsEstimate?: number | null;
  epsActual?: number | null;
  revenueEstimate?: number | null;
  revenueActual?: number | null;
  symbol?: string;
}

interface EarningsResponse {
  earningsCalendar?: FinnhubEarnings[];
}

function toBigInt(v: number | null | undefined): bigint | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return BigInt(Math.round(v));
}

/**
 * Fetches the earnings calendar for one symbol between `from` and `to`
 * (both "YYYY-MM-DD"). Includes both past reports (with actuals) and scheduled
 * future dates (estimates only) -- the future ones are the whole point, since
 * a 7-day directional signal issued across an unknown earnings print is the
 * failure this data source exists to prevent.
 *
 * Finnhub sometimes returns two rows for the same date under different quarter
 * labels, so rows are deduped by date here, preferring whichever row actually
 * carries an epsActual.
 */
export async function fetchEarningsCalendar(symbol: string, from: string, to: string): Promise<RawEarnings[]> {
  const url =
    `${FINNHUB_BASE_URL}/calendar/earnings?symbol=${encodeURIComponent(symbol)}` +
    `&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;

  const res = await finnhubFetch(url);
  const data = (await res.json()) as EarningsResponse;
  const rows = data.earningsCalendar ?? [];

  const byDate = new Map<string, FinnhubEarnings>();
  for (const r of rows) {
    if (!r.date) continue;
    const existing = byDate.get(r.date);
    // Prefer the row with a real actual; otherwise first wins.
    if (!existing || (existing.epsActual == null && r.epsActual != null)) {
      byDate.set(r.date, r);
    }
  }

  return [...byDate.values()].map((r) => ({
    date: new Date(r.date + "T00:00:00.000Z"),
    hour: r.hour && r.hour.length > 0 ? r.hour : null,
    quarter: r.quarter ?? null,
    year: r.year ?? null,
    epsEstimate: r.epsEstimate ?? null,
    epsActual: r.epsActual ?? null,
    revenueEstimate: toBigInt(r.revenueEstimate),
    revenueActual: toBigInt(r.revenueActual),
  }));
}
