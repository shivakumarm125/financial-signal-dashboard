import { prisma, getHitRateSummary, getBacktestHitRateSummary, summarizeOutcomes } from "@financial-adviser/shared";
import {
  TrackRecordSummary,
  IndependenceNote,
  OUTCOME_LABELS,
  outcomeTone,
  directionColor,
  fmtDate,
} from "../components/TrackRecord";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const [signals, backtests, summary, backtestSummary] = await Promise.all([
    prisma.signalRecord.findMany({ orderBy: { createdAt: "desc" }, include: { ticker: true } }),
    prisma.backtestSignal.findMany({ orderBy: { asOfDate: "desc" }, include: { ticker: true }, take: 25 }),
    getHitRateSummary(),
    getBacktestHitRateSummary(),
  ]);

  const pending = signals.filter((s) => s.outcome === null).length;

  // Per-ticker rollup. Computed from the same rows rather than re-querying, so
  // the parts always add up to the whole shown above them.
  const bySymbol = new Map<string, typeof signals>();
  for (const s of signals) {
    const list = bySymbol.get(s.ticker.symbol) ?? [];
    list.push(s);
    bySymbol.set(s.ticker.symbol, list);
  }
  const perTicker = [...bySymbol.entries()]
    .map(([symbol, rows]) => ({
      symbol,
      total: rows.length,
      pending: rows.filter((r) => r.outcome === null).length,
      summary: summarizeOutcomes(
        rows.filter((r) => r.outcome !== null).map((r) => ({ outcome: r.outcome!, outcomeDetail: r.outcomeDetail }))
      ),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return (
    <main>
      <h2 className="text-xl font-medium">Track record</h2>
      <p className="mt-2 text-sm text-muted">
        Every signal this system has published, graded against real daily price bars at a fixed
        7-day horizon.
      </p>

      <section className="mt-8 rounded border border-line bg-white p-6">
        <h3 className="text-xs uppercase tracking-wide text-muted">All tickers combined</h3>
        <TrackRecordSummary summary={summary} pending={pending} />
        <IndependenceNote summary={summary} />
      </section>

      <section className="mt-8">
        <h3 className="text-xs uppercase tracking-wide text-muted">By ticker</h3>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The combined figure above blends tickers that behave very differently — AAPL resolves only
          ~39% of its 7-day windows cleanly, COIN ~97% — so it describes none of them precisely.
          Per-ticker is the more meaningful unit, and the one that answers whether a given ticker is
          worth continuing to track.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-normal">Ticker</th>
                <th className="py-2 text-right font-normal">Signals</th>
                <th className="py-2 text-right font-normal">Target/stop</th>
                <th className="py-2 text-right font-normal">Hit rate</th>
                <th className="py-2 text-right font-normal">Episodes</th>
                <th className="py-2 text-right font-normal">Pending</th>
              </tr>
            </thead>
            <tbody>
              {perTicker.map((t) => (
                <tr key={t.symbol} className="border-b border-line">
                  <td className="py-2">
                    <a href={`/tickers/${t.symbol}`} className="hover:underline">
                      {t.symbol}
                    </a>
                  </td>
                  <td className="py-2 text-right">{t.total}</td>
                  <td className="py-2 text-right">{t.summary.targetStopEvaluated}</td>
                  <td className="py-2 text-right">
                    {t.summary.targetHitRate === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        {t.summary.targetHitRate}%
                        {t.summary.distinctResolutionDays < 10 && (
                          <span className="text-neutralSignal" title="Too few independent episodes to be meaningful">
                            {" "}
                            *
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right">{t.summary.distinctResolutionDays || "—"}</td>
                  <td className="py-2 text-right">{t.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          <span className="text-neutralSignal">*</span> fewer than 10 independent episodes — not yet
          a meaningful rate. &ldquo;Episodes&rdquo; counts distinct market days on which outcomes
          resolved, not signals; several signals closed by one price move are one test.
        </p>
      </section>

      <section className="mt-10">
        <h3 className="text-xs uppercase tracking-wide text-muted">Every signal</h3>
        {signals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No signals published yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Ticker</th>
                  <th className="py-2 font-normal">Signal</th>
                  <th className="py-2 text-right font-normal">Target</th>
                  <th className="py-2 text-right font-normal">Stop</th>
                  <th className="py-2 font-normal">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.id} className="border-b border-line align-top">
                    <td className="py-2 whitespace-nowrap text-muted">{fmtDate(s.createdAt)}</td>
                    <td className="py-2">
                      <a href={`/tickers/${s.ticker.symbol}`} className="hover:underline">
                        {s.ticker.symbol}
                      </a>
                    </td>
                    <td className={`py-2 capitalize ${directionColor(s.direction)}`}>
                      {s.direction} <span className="text-muted">{s.confidence}%</span>
                    </td>
                    <td className="py-2 text-right">
                      {s.targetPrice ? `$${Number(s.targetPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {s.stopLossPrice ? `$${Number(s.stopLossPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className={`py-2 ${outcomeTone(s.outcome)}`}>
                      {OUTCOME_LABELS[s.outcome ?? "pending"] ?? s.outcome}
                      {s.outcomeDetail && <div className="text-xs text-muted">{s.outcomeDetail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 rounded border border-line bg-paper p-6">
        <h3 className="text-xs uppercase tracking-wide text-muted">Historical backtest</h3>
        <p className="mt-2 text-sm text-muted">
          Signals simulated on past dates and graded against price action that had already happened.
          Kept separate from the live record above — these were never published to anyone, and the
          sample has known correlation problems.
        </p>
        <TrackRecordSummary summary={backtestSummary} />
        <IndependenceNote summary={backtestSummary} />

        {backtests.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            {backtests.map((b) => (
              <li key={b.id} className="flex justify-between gap-4">
                <span className="text-muted">
                  {fmtDate(b.asOfDate)} {b.ticker.symbol}
                </span>
                <span className={directionColor(b.direction)}>
                  {b.direction}
                  <span className={`ml-2 ${outcomeTone(b.outcome)}`}>
                    {OUTCOME_LABELS[b.outcome] ?? b.outcome}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-muted">
        Past results say very little about future ones, especially at this sample size. Not financial
        advice — you are solely responsible for your own trading decisions.
      </p>
    </main>
  );
}
