import { prisma } from "@financial-adviser/shared";
import { getCikForSymbol } from "./cikLookup";
import { getNewForm4Filings, FilingRef } from "./submissionsClient";
import { parseForm4Xml } from "./form4Parser";
import { EDGAR_URLS } from "./config";
import { edgarFetch } from "./httpClient";

export interface TickerIngestResult {
  symbol: string;
  status: "ok" | "no_cik" | "error";
  newFilings: number;
  transactionsStored: number;
  parseFailures: number;
  error?: string;
}

function accessionNoDashes(accessionNumber: string): string {
  return accessionNumber.replace(/-/g, "");
}

function cikNoPadding(cik: string): string {
  return String(Number(cik));
}

// EDGAR's submissions API lists primaryDocument as e.g. "xslF345X06/form4.xml" —
// that path (under an xslFxxx/ rendering folder) serves an HTML view for browsers,
// despite the .xml extension. The real machine-readable XML sits at the top level
// of the accession directory under just the base filename, so the xslFxxx/ prefix
// must be stripped before building the fetch URL.
function rawXmlFilename(primaryDocument: string): string {
  const parts = primaryDocument.split("/");
  return parts[parts.length - 1];
}

async function fetchAndParseFiling(cik: string, filing: FilingRef) {
  const url = EDGAR_URLS.archiveDocument(
    cikNoPadding(cik),
    accessionNoDashes(filing.accessionNumber),
    rawXmlFilename(filing.primaryDocument)
  );
  const res = await edgarFetch(url);
  const xml = await res.text();
  return parseForm4Xml(xml);
}

/**
 * Ingests new Form 4 filings for a single ticker: resolves its CIK, fetches
 * anything newer than the last-processed filing, parses each one, and
 * upserts the resulting transaction records. A single filing that fails to
 * parse is logged and skipped rather than aborting the whole ticker (Q8) —
 * a persistent EDGAR/network error, in contrast, does abort this ticker's
 * run and is reported as an error so it's visible, per B7's intent.
 */
export async function ingestFilingsForTicker(symbol: string): Promise<TickerIngestResult> {
  const ticker = await prisma.ticker.upsert({
    where: { symbol: symbol.toUpperCase() },
    update: {},
    create: { symbol: symbol.toUpperCase() },
    include: { filingIngestionState: true },
  });

  let cik = ticker.cik;
  if (!cik) {
    const resolved = await getCikForSymbol(symbol);
    if (!resolved) {
      return { symbol, status: "no_cik", newFilings: 0, transactionsStored: 0, parseFailures: 0 };
    }
    cik = resolved.cik;
    await prisma.ticker.update({
      where: { id: ticker.id },
      data: { cik, name: resolved.name },
    });
  }

  try {
    const sinceAccessionNumber = ticker.filingIngestionState?.lastAccessionNumber ?? null;
    const newFilings = await getNewForm4Filings(cik, sinceAccessionNumber);

    let transactionsStored = 0;
    let parseFailures = 0;

    // Oldest first, so DB writes and the eventual last-seen pointer move forward in time.
    for (const filing of [...newFilings].reverse()) {
      let transactions;
      try {
        transactions = await fetchAndParseFiling(cik, filing);
      } catch (err) {
        parseFailures++;
        console.error(
          `[B1] Skipping unparseable Form 4 filing ${filing.accessionNumber} for ${symbol}:`,
          err instanceof Error ? err.message : err
        );
        continue;
      }

      for (let i = 0; i < transactions.length; i++) {
        const txn = transactions[i];
        await prisma.insiderFiling.upsert({
          where: {
            accessionNumber_transactionIndex: {
              accessionNumber: filing.accessionNumber,
              transactionIndex: i,
            },
          },
          update: {},
          create: {
            tickerId: ticker.id,
            accessionNumber: filing.accessionNumber,
            transactionIndex: i,
            isAmendment: filing.isAmendment,
            insiderName: txn.insiderName,
            insiderIsDirector: txn.insiderIsDirector,
            insiderIsOfficer: txn.insiderIsOfficer,
            insiderOfficerTitle: txn.insiderOfficerTitle,
            insiderIsTenPercentOwner: txn.insiderIsTenPercentOwner,
            transactionCode: txn.transactionCode,
            transactionDate: txn.transactionDate,
            sharesTransacted: txn.sharesTransacted,
            pricePerShare: txn.pricePerShare,
            filedAt: new Date(filing.filingDate),
          },
        });
        transactionsStored++;
      }
    }

    if (newFilings.length > 0) {
      const mostRecent = newFilings[0]; // newFilings is newest-first
      await prisma.filingIngestionState.upsert({
        where: { tickerId: ticker.id },
        update: {
          lastAccessionNumber: mostRecent.accessionNumber,
          lastFilingDate: new Date(mostRecent.filingDate),
        },
        create: {
          tickerId: ticker.id,
          lastAccessionNumber: mostRecent.accessionNumber,
          lastFilingDate: new Date(mostRecent.filingDate),
        },
      });
    }

    return { symbol, status: "ok", newFilings: newFilings.length, transactionsStored, parseFailures };
  } catch (err) {
    return {
      symbol,
      status: "error",
      newFilings: 0,
      transactionsStored: 0,
      parseFailures: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ingests Form 4 filings for a list of tickers, one at a time. One ticker's failure doesn't stop the rest. */
export async function ingestFilings(symbols: string[]): Promise<TickerIngestResult[]> {
  const results: TickerIngestResult[] = [];
  for (const symbol of symbols) {
    results.push(await ingestFilingsForTicker(symbol));
  }
  return results;
}
