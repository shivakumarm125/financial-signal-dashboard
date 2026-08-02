import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestSocial } from "../ingestion/stocktwits/ingestSocial";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run ingest:social --workspace=@financial-adviser/api -- AAPL MSFT");
    process.exit(1);
  }

  console.log(`[B4] Fetching StockTwits cashtag streams for: ${symbols.join(", ")}`);
  const results = await ingestSocial(symbols);

  for (const r of results) {
    if (r.status === "ok") {
      console.log(
        `[B4] ${r.symbol}: ${r.postsStored} post(s) stored — ` +
          `${r.bullish} self-tagged Bullish, ${r.bearish} Bearish (rest untagged).`
      );
    } else if (r.status === "not_found") {
      console.log(`[B4] ${r.symbol}: not listed on StockTwits — reported as a coverage gap, not an error.`);
    } else {
      console.error(`[B4] ${r.symbol}: FAILED — ${r.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[B4] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
