import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestFilings } from "../ingestion/edgar/ingestFilings";
import { ingestPrices } from "../ingestion/twelvedata/ingestPrices";
import { ingestNews } from "../ingestion/finnhub/ingestNews";
import { ingestEarnings } from "../ingestion/finnhub/ingestEarnings";
import { generateSignalWithRetry } from "../analysis/signalRetry";
import { checkAllPendingOutcomes } from "../analysis/signalOutcomes";

/**
 * D1's scheduled entry point: ingest all 3 built sources, then generate a
 * signal, for every currently-tracked ticker. No per-user watchlist to scope
 * this to yet (Epic E not built) -- runs against every Ticker row that
 * exists, same placeholder-until-accounts-exist pattern as C2/C4.
 */
async function main() {
  const tickers = await prisma.ticker.findMany({ select: { symbol: true } });
  const symbols = tickers.map((t) => t.symbol);

  if (symbols.length === 0) {
    console.log("[D1] No tickers tracked yet -- nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`[D1] Running full pipeline for: ${symbols.join(", ")}`);

  console.log("[D1] Ingesting filings (B1)...");
  await ingestFilings(symbols);

  console.log("[D1] Ingesting prices (B2)...");
  await ingestPrices(symbols);

  console.log("[D1] Ingesting news (B3)...");
  await ingestNews(symbols);

  console.log("[D1] Ingesting earnings calendar (B10)...");
  const earningsResults = await ingestEarnings(symbols);
  for (const r of earningsResults) {
    if (r.status === "error") console.error(`[B10] ${r.symbol}: ${r.error}`);
  }

  console.log("[D1] Generating signals (C1-C6)...");
  for (const symbol of symbols) {
    const outcome = await generateSignalWithRetry(symbol);
    console.log(`[D1] ${symbol}: ${outcome.status}`);
  }

  console.log("[C5] Checking outcomes of past signals against real price data...");
  const outcomeResult = await checkAllPendingOutcomes();
  console.log(`[C5] Checked ${outcomeResult.checked}, ${outcomeResult.updated} now have a terminal outcome.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[D1] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
