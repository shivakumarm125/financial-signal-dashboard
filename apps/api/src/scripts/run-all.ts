import "dotenv/config";
import { prisma } from "@financial-adviser/shared";
import { ingestFilings } from "../ingestion/edgar/ingestFilings";
import { ingestPrices } from "../ingestion/twelvedata/ingestPrices";
import { ingestNews } from "../ingestion/finnhub/ingestNews";
import { ingestEarnings } from "../ingestion/finnhub/ingestEarnings";
import { ingestSocial } from "../ingestion/stocktwits/ingestSocial";
import { generateSignalWithRetry } from "../analysis/signalRetry";
import { checkAllPendingOutcomes } from "../analysis/signalOutcomes";

/**
 * D1's scheduled entry point: ingest all built sources, then generate a signal,
 * for every currently-tracked ticker. No per-user watchlist to scope this to
 * yet (Epic E not built) -- runs against every Ticker row that exists, same
 * placeholder-until-accounts-exist pattern as C2/C4.
 *
 * D4: every run now records itself in PipelineRun, and the exit code reflects
 * what actually happened rather than merely whether the script reached the end.
 * The distinction matters -- this job deliberately continues past a single
 * ticker's failure so one bad ticker can't kill the rest, which means a run
 * could previously generate ZERO signals and still exit 0 with a green tick.
 */

interface RunTally {
  tickersAttempted: number;
  signalsGenerated: number;
  signalsFailed: number;
  ingestionErrors: number;
  outcomesUpdated: number;
  problems: string[];
}

export function classify(tally: RunTally): { status: "success" | "partial" | "failed"; detail: string | null } {
  if (tally.tickersAttempted === 0) {
    return { status: "failed", detail: "No tickers tracked -- nothing ran." };
  }
  if (tally.signalsGenerated === 0) {
    return {
      status: "failed",
      detail: `No signals generated for any of ${tally.tickersAttempted} ticker(s). ${tally.problems.join(" | ")}`,
    };
  }
  if (tally.signalsFailed > 0 || tally.ingestionErrors > 0) {
    return {
      status: "partial",
      detail: `${tally.signalsGenerated} signal(s) generated, but ${tally.signalsFailed} failed and ${tally.ingestionErrors} ingestion error(s). ${tally.problems.join(" | ")}`,
    };
  }
  return { status: "success", detail: null };
}

async function main() {
  const run = await prisma.pipelineRun.create({
    data: { status: "running", trigger: process.env.GITHUB_EVENT_NAME ?? "local" },
  });

  const tally: RunTally = {
    tickersAttempted: 0,
    signalsGenerated: 0,
    signalsFailed: 0,
    ingestionErrors: 0,
    outcomesUpdated: 0,
    problems: [],
  };

  try {
    const tickers = await prisma.ticker.findMany({ select: { symbol: true } });
    const symbols = tickers.map((t) => t.symbol);
    tally.tickersAttempted = symbols.length;

    if (symbols.length === 0) {
      console.log("[D1] No tickers tracked yet -- nothing to do.");
    } else {
      console.log(`[D1] Running full pipeline for: ${symbols.join(", ")}`);

      console.log("[D1] Ingesting filings (B1)...");
      const filingResults = await ingestFilings(symbols);
      for (const r of filingResults) {
        if (r.status !== "ok") {
          tally.ingestionErrors++;
          tally.problems.push(`filings/${r.symbol}: ${r.error ?? r.status}`);
          console.error(`[B1] ${r.symbol}: ${r.error ?? r.status}`);
        }
      }

      console.log("[D1] Ingesting prices (B2)...");
      const priceResults = await ingestPrices(symbols);
      for (const r of priceResults) {
        if (r.status !== "ok") {
          tally.ingestionErrors++;
          tally.problems.push(`prices/${r.symbol}: ${r.error ?? "failed"}`);
          console.error(`[B2] ${r.symbol}: ${r.error ?? "failed"}`);
        }
      }

      console.log("[D1] Ingesting news (B3)...");
      await ingestNews(symbols);

      console.log("[D1] Ingesting social/forum posts (B4)...");
      const socialResults = await ingestSocial(symbols);
      for (const r of socialResults) {
        if (r.status === "error") {
          // Social is the one optional source -- a failure degrades the prompt
          // (reported as a coverage gap) rather than invalidating the run.
          tally.ingestionErrors++;
          tally.problems.push(`social/${r.symbol}: ${r.error}`);
          console.error(`[B4] ${r.symbol}: ${r.error}`);
        }
      }
      console.log("[D1] Ingesting earnings calendar (B10)...");
      const earningsResults = await ingestEarnings(symbols);
      for (const r of earningsResults) {
        if (r.status === "error") {
          tally.ingestionErrors++;
          tally.problems.push(`earnings/${r.symbol}: ${r.error}`);
          console.error(`[B10] ${r.symbol}: ${r.error}`);
        }
      }

      console.log("[D1] Generating signals (C1-C6)...");
      for (const symbol of symbols) {
        const outcome = await generateSignalWithRetry(symbol);
        if (outcome.status === "ok") {
          tally.signalsGenerated++;
        } else {
          tally.signalsFailed++;
          tally.problems.push(`signal/${symbol}: ${outcome.status}`);
        }
        console.log(`[D1] ${symbol}: ${outcome.status}`);
      }

      console.log("[C5] Checking outcomes of past signals against real price data...");
      const outcomeResult = await checkAllPendingOutcomes();
      tally.outcomesUpdated = outcomeResult.updated;
      console.log(`[C5] Checked ${outcomeResult.checked}, ${outcomeResult.updated} now have a terminal outcome.`);
    }

    const { status, detail } = classify(tally);

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        tickersAttempted: tally.tickersAttempted,
        signalsGenerated: tally.signalsGenerated,
        signalsFailed: tally.signalsFailed,
        ingestionErrors: tally.ingestionErrors,
        outcomesUpdated: tally.outcomesUpdated,
        detail,
      },
    });

    console.log(`[D4] Run ${status}: ${detail ?? "all stages clean."}`);
    await prisma.$disconnect();

    // Non-zero exit is what makes GitHub Actions go red and send its failure
    // notification. Without this a run that generated nothing still looked green.
    if (status === "failed") process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.pipelineRun
      .update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "failed",
          tickersAttempted: tally.tickersAttempted,
          signalsGenerated: tally.signalsGenerated,
          signalsFailed: tally.signalsFailed,
          ingestionErrors: tally.ingestionErrors,
          outcomesUpdated: tally.outcomesUpdated,
          detail: `Crashed: ${message}`,
        },
      })
      .catch(() => {
        /* the DB itself may be what failed -- don't mask the original error */
      });
    throw err;
  }
}

main().catch(async (err) => {
  console.error("[D1] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
