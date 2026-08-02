import { notFound } from "next/navigation";
import { prisma, computeReachability, getHitRateSummaryForTicker } from "@financial-adviser/shared";
import { ReachabilityDetail } from "../../components/Reachability";
import {
  TrackRecordSummary,
  IndependenceNote,
  NoOutcomesYet,
  OUTCOME_LABELS,
  outcomeTone,
  directionColor as signalDirectionColor,
} from "../../components/TrackRecord";

export const dynamic = "force-dynamic";

function directionColor(direction: string): string {
  if (direction === "bullish") return "text-bullish";
  if (direction === "bearish") return "text-bearish";
  return "text-neutralSignal";
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function TickerDetailPage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) notFound();

  const [priceBars, filings, news, latestSignal] = await Promise.all([
    prisma.priceBar.findMany({ where: { tickerId: ticker.id }, orderBy: { date: "desc" }, take: 10 }),
    prisma.insiderFiling.findMany({ where: { tickerId: ticker.id }, orderBy: { transactionDate: "desc" }, take: 5 }),
    prisma.newsArticle.findMany({ where: { tickerId: ticker.id }, orderBy: { publishedAt: "desc" }, take: 5 }),
    prisma.signalRecord.findFirst({
      where: { tickerId: ticker.id },
      orderBy: { createdAt: "desc" },
      include: { citations: true },
    }),
  ]);

  let citationLabels: Record<string, string> = {};
  if (latestSignal) {
    const filingIds = latestSignal.citations.filter((c) => c.sourceType === "filing").map((c) => c.sourceRecordId);
    const newsIds = latestSignal.citations.filter((c) => c.sourceType === "news").map((c) => c.sourceRecordId);
    const [citedFilings, citedNews] = await Promise.all([
      prisma.insiderFiling.findMany({ where: { id: { in: filingIds } } }),
      prisma.newsArticle.findMany({ where: { id: { in: newsIds } } }),
    ]);
    citationLabels = {
      ...Object.fromEntries(citedFilings.map((f) => [f.id, `${f.insiderName} — ${f.transactionCode} on ${fmtDate(f.transactionDate)}`])),
      ...Object.fromEntries(citedNews.map((n) => [n.id, `${n.source}: ${n.headline}`])),
    };
  }

  const latestBar = priceBars[0];

  const reachability = latestSignal
    ? await computeReachability({
        tickerId: ticker.id,
        direction: latestSignal.direction,
        targetPrice: latestSignal.targetPrice ? Number(latestSignal.targetPrice) : null,
        confidence: latestSignal.confidence,
      })
    : null;

  // Per-ticker track record (B12). The more meaningful unit than the combined
  // figure on /history: tickers differ enough in how often their 7-day windows
  // resolve that pooling them describes none of them.
  const [tickerSummary, tickerSignals] = await Promise.all([
    getHitRateSummaryForTicker(ticker.id),
    prisma.signalRecord.findMany({
      where: { tickerId: ticker.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);
  const tickerPending = tickerSignals.filter((s) => s.outcome === null).length;
  const hasResolved = tickerSummary.totalEvaluated > 0;

  return (
    <main>
      <p className="mb-8">
        <a href="/" className="text-sm text-muted hover:text-ink">
          ← Watchlist
        </a>
      </p>

      <h2 className="text-xl font-medium">
        {ticker.symbol} <span className="text-muted font-normal">{ticker.name}</span>
      </h2>

      {latestSignal ? (
        <section className="mt-6 rounded border border-line bg-white p-6">
          <div className="flex items-baseline justify-between">
            <span className={`text-lg font-medium capitalize ${directionColor(latestSignal.direction)}`}>
              {latestSignal.direction}
            </span>
            <span className="text-sm text-muted">
              {latestSignal.confidence}% direction confidence
              {latestSignal.rawConfidence !== latestSignal.confidence && (
                <span> (Claude said {latestSignal.rawConfidence}%, capped — signals disagreed)</span>
              )}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink">{latestSignal.rationale}</p>

          {(latestSignal.entryGuidance || latestSignal.targetPrice || latestSignal.stopLossPrice) && (
            <div className="mt-4 rounded border border-line bg-paper p-4">
              <p className="text-xs uppercase tracking-wide text-muted">Trade levels — suggestions, not instructions</p>
              {latestSignal.entryGuidance && <p className="mt-2 text-sm text-ink">{latestSignal.entryGuidance}</p>}
              <div className="mt-3 flex gap-6 text-sm">
                {latestSignal.targetPrice && (
                  <div>
                    <span className="text-muted">Target: </span>
                    <span className="font-medium">${Number(latestSignal.targetPrice).toFixed(2)}</span>
                  </div>
                )}
                {latestSignal.stopLossPrice && (
                  <div>
                    <span className="text-muted">Stop-loss: </span>
                    <span className="font-medium">${Number(latestSignal.stopLossPrice).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {reachability && (
            <div className="mt-4">
              <ReachabilityDetail result={reachability} />
            </div>
          )}

          {latestSignal.citations.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-xs uppercase tracking-wide text-muted">Sources cited</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {latestSignal.citations.map((c) => (
                  <li key={c.id}>{citationLabels[c.sourceRecordId] ?? c.sourceRecordId}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-4 text-xs text-muted">
            Generated {fmtDate(latestSignal.createdAt)} · Not financial advice — this AI-generated signal, including
            the price levels above, may be wrong. You are solely responsible for your own trading decisions.
          </p>
        </section>
      ) : (
        <p className="mt-6 text-muted">No signal generated yet for this ticker.</p>
      )}

      <section className="mt-8 rounded border border-line bg-white p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-xs uppercase tracking-wide text-muted">
            Track record — {ticker.symbol} only
          </h3>
          <a href="/history" className="text-xs text-muted hover:text-ink">
            All tickers →
          </a>
        </div>

        {hasResolved ? (
          <>
            <TrackRecordSummary summary={tickerSummary} pending={tickerPending} />
            <IndependenceNote summary={tickerSummary} />
          </>
        ) : (
          <NoOutcomesYet pending={tickerPending} total={tickerSignals.length} />
        )}

        {tickerSignals.length > 0 && (
          <div className="mt-4 overflow-x-auto border-t border-line pt-3">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Signal</th>
                  <th className="pb-2 text-right font-normal">Target</th>
                  <th className="pb-2 text-right font-normal">Stop</th>
                  <th className="pb-2 font-normal">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {tickerSignals.map((s) => (
                  <tr key={s.id} className="border-t border-line align-top">
                    <td className="py-1.5 whitespace-nowrap text-muted">{fmtDate(s.createdAt)}</td>
                    <td className={`py-1.5 capitalize ${signalDirectionColor(s.direction)}`}>
                      {s.direction} <span className="text-muted">{s.confidence}%</span>
                    </td>
                    <td className="py-1.5 text-right">
                      {s.targetPrice ? `$${Number(s.targetPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      {s.stopLossPrice ? `$${Number(s.stopLossPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className={`py-1.5 ${outcomeTone(s.outcome)}`}>
                      {OUTCOME_LABELS[s.outcome ?? "pending"] ?? s.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted">Recent price</h3>
          {latestBar && (
            <p className="mt-2 text-2xl font-medium">${Number(latestBar.close).toFixed(2)}</p>
          )}
          <table className="mt-3 w-full text-sm">
            <tbody>
              {priceBars.map((bar) => (
                <tr key={bar.id} className="border-t border-line">
                  <td className="py-1.5 text-muted">{fmtDate(bar.date)}</td>
                  <td className="py-1.5 text-right">${Number(bar.close).toFixed(2)}</td>
                  <td className="py-1.5 text-right text-muted">{Number(bar.volume).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-muted">Recent insider filings</h3>
          {filings.length === 0 ? (
            <p className="mt-2 text-sm text-muted">None in the last 90 days.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {filings.map((f) => (
                <li key={f.id} className="border-t border-line pt-2">
                  <span className="text-muted">{fmtDate(f.transactionDate)}</span> — {f.insiderName} (
                  {f.transactionCode}) {Number(f.sharesTransacted).toLocaleString()} shares
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-8">
        <h3 className="text-xs uppercase tracking-wide text-muted">Recent news</h3>
        {news.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No recent news found.</p>
        ) : (
          <ul className="mt-2 space-y-3 text-sm">
            {news.map((n) => (
              <li key={n.id} className="border-t border-line pt-3">
                <span className="text-muted">
                  {fmtDate(n.publishedAt)} · {n.source}
                </span>
                <div>{n.headline}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
