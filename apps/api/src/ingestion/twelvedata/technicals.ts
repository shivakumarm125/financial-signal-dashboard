export interface Bar {
  date: Date;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export type VolumeTrend = "up" | "down" | "flat";

export interface Technicals {
  latestClose: number | null;
  ma50: number | null;
  ma200: number | null;
  priceAboveMa50: boolean | null;
  priceAboveMa200: boolean | null;
  avgVolume10d: number | null;
  avgVolume90d: number | null;
  volumeTrend: VolumeTrend;
  // Recent trading range -- gives entry/target/stop-loss guidance (added
  // 2026-07-19, a deliberate scope change) a real basis in actual price
  // action rather than Claude inventing untethered numbers.
  recentHigh20d: number | null;
  recentLow20d: number | null;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Average of the last N closes/volumes, or null if fewer than N bars exist. */
function trailingAverage(bars: Bar[], n: number, field: "close" | "volume"): number | null {
  if (bars.length < n) return null;
  const slice = bars.slice(bars.length - n);
  return average(slice.map((b) => b[field]));
}

/**
 * Computes B2's technicals (per the A5-consumed pre-tag decisions, Q3/Q4):
 * self-computed from already-fetched daily bars, no separate vendor indicator
 * calls. `bars` must be sorted ascending by date (oldest first).
 */
export function computeTechnicals(bars: Bar[]): Technicals {
  const latestClose = bars.length > 0 ? bars[bars.length - 1].close : null;

  const ma50 = trailingAverage(bars, 50, "close");
  const ma200 = trailingAverage(bars, 200, "close");
  const avgVolume10d = trailingAverage(bars, 10, "volume");
  const avgVolume90d = trailingAverage(bars, 90, "volume");

  let volumeTrend: VolumeTrend = "flat";
  if (avgVolume10d !== null && avgVolume90d !== null && avgVolume90d > 0) {
    if (avgVolume10d > avgVolume90d * 1.2) volumeTrend = "up";
    else if (avgVolume10d < avgVolume90d * 0.8) volumeTrend = "down";
  }

  const recentBars = bars.slice(Math.max(0, bars.length - 20));
  const recentHigh20d = recentBars.length > 0 ? Math.max(...recentBars.map((b) => b.high)) : null;
  const recentLow20d = recentBars.length > 0 ? Math.min(...recentBars.map((b) => b.low)) : null;

  return {
    latestClose,
    ma50,
    ma200,
    priceAboveMa50: ma50 !== null && latestClose !== null ? latestClose > ma50 : null,
    priceAboveMa200: ma200 !== null && latestClose !== null ? latestClose > ma200 : null,
    avgVolume10d,
    avgVolume90d,
    volumeTrend,
    recentHigh20d,
    recentLow20d,
  };
}
