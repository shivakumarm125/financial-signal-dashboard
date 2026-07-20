import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestFilings } from "../ingestion/edgar/ingestFilings";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run ingest:filings --workspace=@financial-adviser/api -- AAPL MSFT TSLA");
    process.exit(1);
  }

  console.log(`[B1] Ingesting Form 4 filings for: ${symbols.join(", ")}`);
  const results = await ingestFilings(symbols);

  for (const r of results) {
    if (r.status === "ok") {
      console.log(
        `[B1] ${r.symbol}: ${r.newFilings} new filing(s), ${r.transactionsStored} transaction(s) stored` +
          (r.parseFailures > 0 ? `, ${r.parseFailures} skipped (parse failure)` : "")
      );
    } else if (r.status === "no_cik") {
      console.warn(`[B1] ${r.symbol}: no CIK found in SEC's company_tickers.json, skipped`);
    } else {
      console.error(`[B1] ${r.symbol}: FAILED — ${r.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[B1] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
