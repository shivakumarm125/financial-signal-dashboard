import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestPrices } from "../ingestion/twelvedata/ingestPrices";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run ingest:prices --workspace=@financial-adviser/api -- AAPL MSFT");
    process.exit(1);
  }

  console.log(
    `[B2] Fetching daily price bars for: ${symbols.join(", ")} ` +
      `(1 Twelve Data API call per ticker -- quota is very limited, 800/day)`
  );
  const results = await ingestPrices(symbols);

  for (const r of results) {
    if (r.status === "ok") {
      console.log(`[B2] ${r.symbol}: ${r.barsStored} new bar(s) stored.`);
      if (r.technicals) {
        const t = r.technicals;
        console.log(
          `       MA50=${t.ma50?.toFixed(2) ?? "n/a"} MA200=${t.ma200?.toFixed(2) ?? "n/a"} ` +
            `aboveMA50=${t.priceAboveMa50 ?? "n/a"} aboveMA200=${t.priceAboveMa200 ?? "n/a"} ` +
            `volumeTrend=${t.volumeTrend}`
        );
      }
    } else {
      console.error(`[B2] ${r.symbol}: FAILED — ${r.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[B2] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
