import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestSocial } from "../ingestion/reddit/ingestSocial";
import { REDDIT_CONFIGURED, SUBREDDITS } from "../ingestion/reddit/config";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npm run ingest:social --workspace=@financial-adviser/api -- AAPL MSFT");
    process.exit(1);
  }

  if (!REDDIT_CONFIGURED) {
    console.error(
      "[B4] REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set.\n" +
        "     Create a 'script' app at https://www.reddit.com/prefs/apps -- the client ID is the\n" +
        "     short string shown under the app name, and the secret is the field labelled 'secret'.\n" +
        "     Also set REDDIT_USER_AGENT, e.g. \"web:financial-signal-dashboard:0.1.0 (by /u/yourname)\"."
    );
    process.exit(1);
  }

  console.log(`[B4] Searching r/${SUBREDDITS.join(", r/")} for: ${symbols.join(", ")}`);
  const results = await ingestSocial(symbols);

  for (const r of results) {
    if (r.status === "ok") {
      console.log(`[B4] ${r.symbol}: ${r.postsStored} post(s) stored.`);
    } else if (r.status === "not_configured") {
      console.log(`[B4] ${r.symbol}: skipped -- Reddit not configured.`);
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
