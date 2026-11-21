import { prisma } from "@financial-adviser/shared";
import type { MarketFacts } from "./plain";

const INSIDER_LOOKBACK_DAYS = 90;
// Enough calendar days to cover 200 trading days for the long average.
const PRICE_LOOKBACK_DAYS = 300;

function average(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * The facts behind the plain "what we're seeing" lines, for several tickers in
 * a fixed handful of queries. Deliberately not one query set per ticker: the
 * production database allows one connection, and fanning out per ticker is what
 * caused the /manage 500 (commit 132fb72).
 *
 * Trend uses the same 50/200-day averages the signal pipeline pre-tags. Only
 * insider BUYS are counted: executives sell routinely (scheduled plans, taxes),
 * so "insiders are selling" would read as a warning when it usually isn't one.
 */
export async function loadMarketFacts(tickerIds: string[]): Promise<Map<string, MarketFacts>> {
  const now = new Date();
  const since = new Date(now.getTime() - PRICE_LOOKBACK_DAYS * 86_400_000);
  const insiderSince = new Date(now.getTime() - INSIDER_LOOKBACK_DAYS * 86_400_000);
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");

  const bars = await prisma.priceBar.findMany({
    where: { tickerId: { in: tickerIds }, date: { gte: since } },
    select: { tickerId: true, date: true, close: true },
    orderBy: { date: "asc" },
  });
  const buys = await prisma.insiderFiling.groupBy({
    by: ["tickerId"],
    where: { tickerId: { in: tickerIds }, transactionCode: "P", transactionDate: { gte: insiderSince } },
    _count: true,
  });
  const earnings = await prisma.earningsEvent.findMany({
    where: { tickerId: { in: tickerIds }, date: { gte: today } },
    select: { tickerId: true, date: true },
    orderBy: { date: "asc" },
  });

  const closesBy = new Map<string, number[]>();
  for (const b of bars) {
    const list = closesBy.get(b.tickerId) ?? [];
    list.push(Number(b.close));
    closesBy.set(b.tickerId, list);
  }

  const facts = new Map<string, MarketFacts>();
  for (const id of tickerIds) {
    const closes = closesBy.get(id) ?? [];
    const price = closes.at(-1) ?? null;
    const weekAgo = closes.length > 5 ? closes[closes.length - 6] : null;

    let trend: MarketFacts["trend"] = null;
    if (price !== null && closes.length >= 200) {
      const ma50 = average(closes.slice(-50));
      const ma200 = average(closes.slice(-200));
      trend = price > ma50 && price > ma200 ? "up" : price < ma50 && price < ma200 ? "down" : "mixed";
    }

    const next = earnings.find((e) => e.tickerId === id);
    facts.set(id, {
      price,
      weekChangePct: price !== null && weekAgo ? ((price - weekAgo) / weekAgo) * 100 : null,
      trend,
      insiderBuys: buys.find((b) => b.tickerId === id)?._count ?? 0,
      daysToEarnings: next ? Math.round((next.date.getTime() - today.getTime()) / 86_400_000) : null,
    });
  }
  return facts;
}

/** Right/wrong counts for live calls that clearly reached one of their two levels. */
export async function loadReliability(tickerId?: string): Promise<{ right: number; wrong: number }> {
  const grouped = await prisma.signalRecord.groupBy({
    by: ["outcome"],
    where: { outcome: { in: ["hit_target", "hit_stop"] }, ...(tickerId ? { tickerId } : {}) },
    _count: true,
  });
  const count = (o: string) => grouped.find((g) => g.outcome === o)?._count ?? 0;
  return { right: count("hit_target"), wrong: count("hit_stop") };
}
