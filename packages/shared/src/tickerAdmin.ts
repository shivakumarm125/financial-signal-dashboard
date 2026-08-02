import { prisma } from "./client";

export interface DeletedCounts {
  signals: number;
  backtests: number;
  bars: number;
  filings: number;
  news: number;
  earnings: number;
}

/**
 * Deletes a ticker and everything belonging to it, in one transaction.
 *
 * Explicit rather than relying on schema-level cascade deletes, for two
 * reasons: the order and scope of what gets destroyed is stated in code rather
 * than implied by the schema, and real counts come back so the UI can tell the
 * user what a year of history actually cost them. "Silently deletes everything"
 * is not a property worth having behind a button.
 *
 * Lives in `shared` rather than in the web app's server action so it can be
 * tested directly -- foreign-key ordering is the part most likely to be wrong,
 * and the worst possible time to discover that is when someone clicks Remove.
 *
 * NOTE: any new model with a tickerId must be added here. There is no cascade
 * to fall back on, so a forgotten table shows up as a foreign-key violation.
 */
export async function deleteTickerCascade(tickerId: string): Promise<DeletedCounts> {
  return prisma.$transaction(async (tx) => {
    // Citations reference signal records, so they must go before the signals.
    await tx.signalCitation.deleteMany({ where: { signal: { tickerId } } });

    const signals = await tx.signalRecord.deleteMany({ where: { tickerId } });
    const backtests = await tx.backtestSignal.deleteMany({ where: { tickerId } });
    const bars = await tx.priceBar.deleteMany({ where: { tickerId } });
    const filings = await tx.insiderFiling.deleteMany({ where: { tickerId } });
    const news = await tx.newsArticle.deleteMany({ where: { tickerId } });
    const earnings = await tx.earningsEvent.deleteMany({ where: { tickerId } });

    await tx.usageRecord.deleteMany({ where: { tickerId } });
    await tx.priceIngestionState.deleteMany({ where: { tickerId } });
    await tx.newsIngestionState.deleteMany({ where: { tickerId } });
    await tx.filingIngestionState.deleteMany({ where: { tickerId } });

    await tx.ticker.delete({ where: { id: tickerId } });

    return {
      signals: signals.count,
      backtests: backtests.count,
      bars: bars.count,
      filings: filings.count,
      news: news.count,
      earnings: earnings.count,
    };
  });
}
