import { prisma } from "@financial-adviser/shared";
import { AddTickerForm, RemoveTickerForm } from "./TickerForms";
import { MAX_TICKERS } from "./config";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/** Flags a source that has no data at all — the signal that a ticker was added but never ingested. */
function count(n: number): { text: string; className: string } {
  return n === 0 ? { text: "none", className: "text-bearish" } : { text: n.toLocaleString(), className: "" };
}

export default async function ManagePage() {
  const tickers = await prisma.ticker.findMany({ orderBy: { symbol: "asc" } });

  // Aggregate per table rather than per ticker. The obvious version -- seven
  // queries inside a map over tickers -- issues 7xN concurrent queries, which
  // is what took this page down in production: with connection_limit=1 (correct
  // for serverless, see client.ts) they queue on one connection and blow
  // Prisma's 10s pool timeout with P2024. Five groupBys is a fixed cost no
  // matter how many tickers are on the watchlist.
  const [barStats, filingStats, newsStats, earningsStats, signalStats] = await Promise.all([
    prisma.priceBar.groupBy({ by: ["tickerId"], _count: { _all: true }, _max: { date: true } }),
    prisma.insiderFiling.groupBy({ by: ["tickerId"], _count: { _all: true } }),
    prisma.newsArticle.groupBy({ by: ["tickerId"], _count: { _all: true } }),
    prisma.earningsEvent.groupBy({ by: ["tickerId"], _count: { _all: true } }),
    prisma.signalRecord.groupBy({ by: ["tickerId"], _count: { _all: true }, _max: { createdAt: true } }),
  ]);

  const countOf = (stats: { tickerId: string; _count: { _all: number } }[], id: string) =>
    stats.find((s) => s.tickerId === id)?._count._all ?? 0;

  const rows = tickers.map((t) => ({
    ticker: t,
    bars: countOf(barStats, t.id),
    filings: countOf(filingStats, t.id),
    news: countOf(newsStats, t.id),
    earnings: countOf(earningsStats, t.id),
    signals: countOf(signalStats, t.id),
    latestBarDate: barStats.find((s) => s.tickerId === t.id)?._max.date ?? null,
    latestSignalDate: signalStats.find((s) => s.tickerId === t.id)?._max.createdAt ?? null,
  }));

  const full = tickers.length >= MAX_TICKERS;

  return (
    <main>
      <h2 className="text-xl font-medium">Manage watchlist</h2>
      <p className="mt-2 text-sm text-muted">
        {tickers.length} of {MAX_TICKERS} tickers tracked. Everything listed here is picked up by the
        daily pipeline run.
      </p>

      <section className="mt-8 rounded border border-line bg-white p-6">
        <h3 className="text-xs uppercase tracking-wide text-muted">Add a ticker</h3>
        <p className="mt-2 mb-3 text-xs leading-relaxed text-muted">
          Adding a symbol enrols it in the daily run; its price, news, filings and earnings data are
          ingested then, and it gets its first signal on the same run. Nothing is fetched right now —
          a first EDGAR backfill takes tens of minutes, far longer than a web request can wait.
        </p>
        {full ? (
          <p className="text-sm text-bearish">
            Watchlist is full at {MAX_TICKERS}. Remove a ticker before adding another.
          </p>
        ) : (
          <AddTickerForm full={full} />
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Worth screening a candidate first —{" "}
          <code className="rounded bg-paper px-1">
            npm run screen:candidates --workspace=@financial-adviser/api -- SYMBOL
          </code>{" "}
          reports how often its 7-day windows actually resolve, how independent its insider data is,
          and how much news it gets. A ticker that rarely resolves produces signals that can never be
          graded, whatever the analysis says.
        </p>
      </section>

      <section className="mt-8">
        <h3 className="text-xs uppercase tracking-wide text-muted">Tracked tickers &amp; data status</h3>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No tickers tracked yet. Add one above.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-normal">Ticker</th>
                  <th className="py-2 text-right font-normal">Bars</th>
                  <th className="py-2 text-right font-normal">Filings</th>
                  <th className="py-2 text-right font-normal">News</th>
                  <th className="py-2 text-right font-normal">Earnings</th>
                  <th className="py-2 text-right font-normal">Signals</th>
                  <th className="py-2 font-normal">Latest bar</th>
                  <th className="py-2 font-normal">Last signal</th>
                  <th className="py-2 font-normal">Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bars = count(r.bars);
                  const filings = count(r.filings);
                  const news = count(r.news);
                  const earnings = count(r.earnings);
                  return (
                    <tr key={r.ticker.id} className="border-b border-line align-top">
                      <td className="py-3">
                        <a href={`/tickers/${r.ticker.symbol}`} className="font-medium hover:underline">
                          {r.ticker.symbol}
                        </a>
                        <div className="text-xs text-muted">{r.ticker.name ?? "not yet resolved"}</div>
                      </td>
                      <td className={`py-3 text-right ${bars.className}`}>{bars.text}</td>
                      <td className={`py-3 text-right ${filings.className}`}>{filings.text}</td>
                      <td className={`py-3 text-right ${news.className}`}>{news.text}</td>
                      <td className={`py-3 text-right ${earnings.className}`}>{earnings.text}</td>
                      <td className="py-3 text-right">{r.signals}</td>
                      <td className="py-3 text-muted whitespace-nowrap">{fmtDate(r.latestBarDate)}</td>
                      <td className="py-3 text-muted whitespace-nowrap">{fmtDate(r.latestSignalDate)}</td>
                      <td className="py-3">
                        <RemoveTickerForm symbol={r.ticker.symbol} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          <span className="text-bearish">none</span> in a data column means that source has never
          ingested for this ticker — expected for something added since the last run, and a problem
          if it persists past one. Removing a ticker permanently deletes its price history, filings,
          news, signals and backtest results; you&apos;ll be told exactly how much before it happens.
        </p>
      </section>
    </main>
  );
}
