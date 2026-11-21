import { prisma, getHitRateSummary, getBacktestHitRateSummary } from "@financial-adviser/shared";
import { verdictFor, outcomeInWords, reliabilityInWords, fmtDay } from "../lib/plain";

export const dynamic = "force-dynamic";

const RECENT_SHOWN = 30;

export default async function PastResultsPage() {
  // Sequential on purpose: production allows one database connection.
  const signals = await prisma.signalRecord.findMany({ orderBy: { createdAt: "desc" }, include: { ticker: true } });
  const summary = await getHitRateSummary();
  const backtest = await getBacktestHitRateSummary();

  const count = (o: string) => signals.filter((s) => s.outcome === o).length;
  const right = count("hit_target");
  const wrong = count("hit_stop");
  const unclear = signals.filter((s) => s.outcome !== null && s.outcome !== "hit_target" && s.outcome !== "hit_stop").length;
  const waiting = signals.filter((s) => s.outcome === null).length;
  const total = signals.length || 1;

  const bySymbol = new Map<string, { right: number; wrong: number }>();
  for (const s of signals) {
    const row = bySymbol.get(s.ticker.symbol) ?? { right: 0, wrong: 0 };
    if (s.outcome === "hit_target") row.right++;
    if (s.outcome === "hit_stop") row.wrong++;
    bySymbol.set(s.ticker.symbol, row);
  }
  const perStock = [...bySymbol.entries()].sort(([a], [b]) => a.localeCompare(b));

  const btRight = backtest.counts.hit_target ?? 0;
  const btWrong = backtest.counts.hit_stop ?? 0;

  // Every call this system has made, as one bar: what happened to each.
  const parts = [
    { n: right, label: "went as expected", bar: "bg-bullish", dot: "bg-bullish" },
    { n: wrong, label: "went the other way", bar: "bg-bearish", dot: "bg-bearish" },
    { n: unclear, label: "no call, or no clear result", bar: "bg-line", dot: "bg-line" },
    { n: waiting, label: "still waiting to see", bar: "bg-white ring-1 ring-inset ring-line", dot: "bg-white ring-1 ring-line" },
  ];

  return (
    <main>
      <h1 className="max-w-[18ch] text-[2.6rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[3.25rem]">
        <span className="text-bullish">{right} calls went as expected.</span>{" "}
        <span className="text-bearish">{wrong} went the other way.</span>
      </h1>
      <p className="mt-4 max-w-[36rem] text-[1.05rem] leading-relaxed">{reliabilityInWords(right, wrong)}</p>

      <section className="mt-10" aria-label="What happened to every call">
        <div className="flex h-4 overflow-hidden rounded-full bg-white">
          {parts.map((p) =>
            p.n > 0 ? <div key={p.label} className={p.bar} style={{ width: `${(p.n / total) * 100}%` }} /> : null
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${p.dot}`} />
              <span>
                <span className="font-semibold">{p.n}</span> <span className="text-muted">{p.label}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[15px] text-muted">Each call is checked a week later against what the price actually did.</p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold tracking-[-0.01em]">By stock</h2>
        <ul className="mt-4 divide-y divide-line rounded-2xl bg-white">
          {perStock.map(([symbol, r]) => {
            const n = r.right + r.wrong;
            return (
              <li key={symbol}>
                <a
                  href={`/tickers/${symbol}`}
                  className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-4 px-5 py-3.5 text-[15px] hover:bg-mist/60 sm:px-7"
                >
                  <span className="font-bold">{symbol}</span>
                  <span className="flex h-2 overflow-hidden rounded-full bg-line">
                    {n > 0 && (
                      <>
                        <span className="bg-bullish" style={{ width: `${(r.right / n) * 100}%` }} />
                        <span className="bg-bearish" style={{ width: `${(r.wrong / n) * 100}%` }} />
                      </>
                    )}
                  </span>
                  <span className="text-muted">{n === 0 ? "none checked yet" : `${r.right} of ${n} as expected`}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold tracking-[-0.01em]">Recent calls</h2>
        <p className="mt-1 text-[15px] text-muted">Up and down calls only. Days with no clear direction are left out.</p>
        <ul className="mt-4 divide-y divide-line rounded-2xl bg-white">
          {signals
            .filter((s) => s.direction !== "neutral")
            .slice(0, RECENT_SHOWN)
            .map((s) => {
            const v = verdictFor(s.direction);
            const o = outcomeInWords(s.outcome);
            return (
              <li
                key={s.id}
                className="grid grid-cols-[5.5rem_3.5rem_1fr] items-baseline gap-3 px-5 py-3 text-[15px] sm:grid-cols-[5.5rem_4rem_4.5rem_1fr] sm:px-7"
              >
                <span className="text-muted">{fmtDay(s.createdAt)}</span>
                <a href={`/tickers/${s.ticker.symbol}`} className="font-bold hover:underline">
                  {s.ticker.symbol}
                </a>
                <span className={`hidden font-medium sm:block ${v.tone}`}>
                  {s.direction === "neutral" ? "No call" : s.direction === "bullish" ? "Up" : "Down"}
                </span>
                <span className={`text-right ${o.tone}`}>{o.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <details className="mt-8 rounded-2xl bg-white px-5 py-4 sm:px-7">
        <summary className="flex cursor-pointer items-center gap-2 text-[1.05rem] font-semibold">
          <span aria-hidden className="chevron inline-block text-muted">
            ›
          </span>
          About these numbers
        </summary>
        <div className="mt-4 max-w-[38rem] space-y-3 text-[15px] leading-relaxed">
          <p>
            A call counts as <span className="text-bullish">went as expected</span> if the price reached the level it
            pointed to before reaching the level that would prove it wrong, within a week. Calls where neither happened
            are left out of the score, because a small drift says little either way.
          </p>
          {summary.targetStopEvaluated > summary.distinctResolutionDays && (
            <p>
              The real evidence is thinner than the counts suggest: those {summary.targetStopEvaluated} results were
              settled on only {summary.distinctResolutionDays} different market days. When one big market move settles
              several calls at once, that is closer to one test than several.
            </p>
          )}
          <p>
            For comparison: when this was last checked (21 Nov 2026), simply guessing &ldquo;up&rdquo; every time
            would have done better than these calls over the same period. Until they clearly beat simple guesses like
            that, treat them as an opinion to weigh, not a prediction.
          </p>
          {btRight + btWrong > 0 && (
            <p className="text-muted">
              Separately, calls were also re-created for past dates the system missed, and checked against what
              happened next: {btRight} of {btRight + btWrong} went as expected. These were never shown to anyone at the
              time, so they are kept out of the numbers above.
            </p>
          )}
        </div>
      </details>
    </main>
  );
}
