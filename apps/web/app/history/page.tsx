import { prisma, getHitRateSummary, getBacktestHitRateSummary } from "@financial-adviser/shared";
import type { HitRateSummary } from "@financial-adviser/shared";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function directionColor(direction: string): string {
  if (direction === "bullish") return "text-bullish";
  if (direction === "bearish") return "text-bearish";
  return "text-neutralSignal";
}

const OUTCOME_LABELS: Record<string, string> = {
  hit_target: "Target hit",
  hit_stop: "Stopped out",
  ambiguous_same_day: "Both levels touched",
  expired_direction_correct: "Direction right, no level hit",
  expired_direction_wrong: "Direction wrong, no level hit",
  no_evaluation: "Not graded",
  pending: "Pending",
};

function outcomeTone(outcome: string | null): string {
  if (outcome === "hit_target" || outcome === "expired_direction_correct") return "text-bullish";
  if (outcome === "hit_stop" || outcome === "expired_direction_wrong") return "text-bearish";
  return "text-muted";
}

function Summary({ summary, pending }: { summary: HitRateSummary; pending?: number }) {
  const notGraded = summary.counts.no_evaluation ?? 0;

  return (
    <dl className="mt-4 space-y-2 text-sm">
      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="text-muted">Target / stop reached</dt>
        <dd>
          {summary.targetStopEvaluated} evaluated
          {summary.targetStopEvaluated > 0 && (
            <>
              {" — "}
              <span className="text-bullish">{summary.counts.hit_target ?? 0} hit target</span>,{" "}
              <span className="text-bearish">{summary.counts.hit_stop ?? 0} stopped out</span> (
              <span className="font-medium">{summary.targetHitRate}%</span>)
            </>
          )}
        </dd>
      </div>

      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="text-muted">Direction only (neither level hit)</dt>
        <dd>
          {summary.directionOnlyEvaluated} evaluated
          {summary.directionOnlyEvaluated > 0 && (
            <>
              {" — "}
              <span className="text-bullish">{summary.counts.expired_direction_correct ?? 0} correct</span>,{" "}
              <span className="text-bearish">{summary.counts.expired_direction_wrong ?? 0} wrong</span> (
              <span className="font-medium">{summary.directionAccuracy}%</span>)
            </>
          )}
        </dd>
      </div>

      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="text-muted">Not graded (neutral or no levels set)</dt>
        <dd>{notGraded}</dd>
      </div>

      {pending !== undefined && (
        <div className="flex justify-between gap-4 border-t border-line pt-2">
          <dt className="text-muted">Still inside their 7-day horizon</dt>
          <dd>{pending}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Below this many independent episodes, a hit rate is noise with a percent sign
 * on it and is labelled as such rather than presented as a track record.
 */
const MIN_MEANINGFUL_EPISODES = 10;

function pluralDays(n: number): string {
  return n === 1 ? "1 distinct market day" : `${n} distinct market days`;
}

/**
 * Keeps the hit rate above from overstating itself, in two separate ways.
 *
 * Overlap: four of the five live target/stop outcomes resolved on the same
 * 2026-07-31 down day — one price move closing four signals is one test, not
 * four. Absolute size: the backtest's "100%" comes from a single outcome, which
 * has no overlap problem at all and is still meaningless. Both need saying.
 */
function IndependenceNote({ summary }: { summary: HitRateSummary }) {
  if (summary.targetStopEvaluated === 0) return null;

  const episodes = summary.distinctResolutionDays;
  const overlapping = summary.targetStopEvaluated > episodes;
  const tooSmall = episodes < MIN_MEANINGFUL_EPISODES;

  return (
    <p
      className={`mt-4 rounded border p-3 text-xs leading-relaxed ${
        overlapping || tooSmall
          ? "border-neutralSignal/40 bg-neutralSignal/5 text-ink"
          : "border-line bg-paper text-muted"
      }`}
    >
      {(overlapping || tooSmall) && (
        <span className="font-medium">Read that hit rate carefully. </span>
      )}
      {overlapping ? (
        <>
          Those {summary.targetStopEvaluated} outcomes resolved on only{" "}
          <span className="font-medium">{pluralDays(episodes)}</span> — several signals were closed
          out by the same single price move, so they are not independent tests. Treat it as roughly{" "}
          {episodes} {episodes === 1 ? "episode" : "episodes"}, not {summary.targetStopEvaluated}.
        </>
      ) : (
        <>
          {summary.targetStopEvaluated === 1
            ? "This 1 outcome resolved on "
            : `These ${summary.targetStopEvaluated} outcomes resolved across `}
          {pluralDays(episodes)}.
        </>
      )}
      {tooSmall && (
        <>
          {" "}
          At {episodes} {episodes === 1 ? "episode" : "episodes"} the percentage carries no real
          predictive weight — it needs at least {MIN_MEANINGFUL_EPISODES} independent ones before
          it means anything. Shown for transparency, not as a track record.
        </>
      )}
    </p>
  );
}

export default async function HistoryPage() {
  const [signals, backtests, summary, backtestSummary] = await Promise.all([
    prisma.signalRecord.findMany({
      orderBy: { createdAt: "desc" },
      include: { ticker: true },
    }),
    prisma.backtestSignal.findMany({
      orderBy: { asOfDate: "desc" },
      include: { ticker: true },
      take: 25,
    }),
    getHitRateSummary(),
    getBacktestHitRateSummary(),
  ]);

  const pending = signals.filter((s) => s.outcome === null).length;

  return (
    <main>
      <h2 className="text-xl font-medium">Track record</h2>
      <p className="mt-2 text-sm text-muted">
        Every signal this system has published, graded against real daily price bars at a fixed
        7-day horizon.
      </p>

      <section className="mt-8 rounded border border-line bg-white p-6">
        <h3 className="text-xs uppercase tracking-wide text-muted">Live signals</h3>
        <Summary summary={summary} pending={pending} />
        <IndependenceNote summary={summary} />
      </section>

      <section className="mt-8">
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
                    <td className="py-2 text-muted whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                    <td className="py-2">
                      <a href={`/tickers/${s.ticker.symbol}`} className="hover:underline">
                        {s.ticker.symbol}
                      </a>
                    </td>
                    <td className={`py-2 capitalize ${directionColor(s.direction)}`}>
                      {s.direction}{" "}
                      <span className="text-muted">{s.confidence}%</span>
                    </td>
                    <td className="py-2 text-right">
                      {s.targetPrice ? `$${Number(s.targetPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {s.stopLossPrice ? `$${Number(s.stopLossPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className={`py-2 ${outcomeTone(s.outcome)}`}>
                      {OUTCOME_LABELS[s.outcome ?? "pending"] ?? s.outcome}
                      {s.outcomeDetail && (
                        <div className="text-xs text-muted">{s.outcomeDetail}</div>
                      )}
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
        <Summary summary={backtestSummary} />
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
