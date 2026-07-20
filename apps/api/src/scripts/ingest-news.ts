import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestNews } from "../ingestion/finnhub/ingestNews";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run ingest:news --workspace=@financial-adviser/api -- AAPL MSFT");
    process.exit(1);
  }

  console.log(`[B3] Fetching news for: ${symbols.join(", ")}`);
  const results = await ingestNews(symbols);

  for (const r of results) {
    if (r.status === "ok") {
      console.log(`[B3] ${r.symbol}: ${r.articlesStored} article(s) stored.`);
    } else {
      console.error(`[B3] ${r.symbol}: FAILED — ${r.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[B3] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
