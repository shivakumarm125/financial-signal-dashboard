"use server";

import { prisma, deleteTickerCascade } from "@financial-adviser/shared";
import { revalidatePath } from "next/cache";
import { MAX_TICKERS, type ActionResult } from "./config";

// US equities: 1-6 chars, optional dot/hyphen class suffix (BRK.B, RDS-A).
const SYMBOL_PATTERN = /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/;

/**
 * Adds a ticker to the watchlist.
 *
 * Deliberately does NOT ingest anything. Two reasons: the web app holds only
 * DATABASE_URL and no provider API keys (a boundary worth keeping -- fewer
 * places holding credentials), and a first-run EDGAR backfill takes tens of
 * minutes, far beyond any serverless request. run-all.ts already ingests every
 * Ticker row that exists, so creating the row IS the enrolment, and the next
 * scheduled run populates it.
 *
 * The consequence is that symbol validity can't be confirmed here -- only its
 * shape. A symbol that doesn't exist will fail ingestion on the next run, which
 * D4 now records as an ingestion error and surfaces on the dashboard rather
 * than failing silently.
 */
export async function addTicker(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const raw = String(formData.get("symbol") ?? "").trim().toUpperCase();

  if (raw.length === 0) {
    return { ok: false, message: "Enter a ticker symbol." };
  }
  if (!SYMBOL_PATTERN.test(raw)) {
    return { ok: false, message: `"${raw}" doesn't look like a US ticker symbol (letters, optionally like BRK.B).` };
  }

  const existing = await prisma.ticker.findUnique({ where: { symbol: raw } });
  if (existing) {
    return { ok: false, message: `${raw} is already on the watchlist.` };
  }

  const count = await prisma.ticker.count();
  if (count >= MAX_TICKERS) {
    return {
      ok: false,
      message: `Watchlist is full (${MAX_TICKERS} tickers). Remove one before adding another.`,
    };
  }

  await prisma.ticker.create({ data: { symbol: raw } });

  revalidatePath("/manage");
  revalidatePath("/");
  return {
    ok: true,
    message: `${raw} added. Its price, news, filings and earnings data will be ingested on the next scheduled run, and it will get its first signal then.`,
  };
}

/**
 * Removes a ticker and everything belonging to it. The cascade itself lives in
 * `shared` as deleteTickerCascade so its foreign-key ordering can be tested
 * directly rather than only exercised by clicking this button.
 *
 * Requires typing the symbol to confirm -- this destroys a year of price
 * history and the ticker's entire track record, and there is no undo.
 */
export async function removeTicker(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  const confirmation = String(formData.get("confirm") ?? "").trim().toUpperCase();

  if (confirmation !== symbol) {
    return { ok: false, message: `Type ${symbol} exactly to confirm removal.` };
  }

  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) {
    return { ok: false, message: `${symbol} isn't on the watchlist.` };
  }

  const removed = await deleteTickerCascade(ticker.id);

  revalidatePath("/manage");
  revalidatePath("/");
  return {
    ok: true,
    message:
      `${symbol} removed, along with ${removed.signals} signal(s), ${removed.backtests} backtest result(s), ` +
      `${removed.bars} price bar(s), ${removed.filings} filing row(s), ${removed.news} article(s) and ${removed.earnings} earnings event(s).`,
  };
}
