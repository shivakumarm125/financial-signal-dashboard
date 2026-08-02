import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestEarnings } from "../ingestion/finnhub/ingestEarnings";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run ingest:earnings --workspace=@financial-adviser/api -- AAPL MSFT");
    process.exit(1);
  }

  console.log(`[B10] Fetching earnings calendar for: ${symbols.join(", ")}`);
  const results = await ingestEarnings(symbols);

  for (const r of results) {
    if (r.status === "ok") {
      console.log(
        `[B10] ${r.symbol}: ${r.eventsStored} event(s) stored. Next report: ${r.nextEarnings ?? "none scheduled"}`
      );
    } else {
      console.error(`[B10] ${r.symbol}: FAILED — ${r.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[B10] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
