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

  return (
    <main>
      <h1 className="text-2xl font-semibold">Past results</h1>
      <p className="mt-1 text-[15px] text-muted">
        Each call is checked a week later against what the price actually did.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={right} label="Went as expected" tone="text-bullish" />
        <Stat value={wrong} label="Went the other way" tone="text-bearish" />
        <Stat value={unclear} label="No call, or no clear result" tone="text-muted" />
        <Stat value={waiting} label="Still waiting to see" tone="text-muted" />
      </section>
      <p className="mt-4 text-[15px] leading-relaxed">{reliabilityInWords(right, wrong)}</p>

      <section className="mt-8">
        <h2 className="text-base font-semibold">By stock</h2>
        <ul className="mt-2 divide-y divide-line rounded-xl bg-white ring-1 ring-line">
          {perStock.map(([symbol, r]) => (
            <li key={symbol}>
              <a href={`/tickers/${symbol}`} className="flex items-center justify-between px-4 py-2.5 text-[15px] hover:bg-paper">
                <span className="font-medium">{symbol}</span>
                <span className="text-muted">
                  {r.right + r.wrong === 0 ? "nothing checked yet" : `${r.right} of ${r.right + r.wrong} went as expected`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Recent calls</h2>
        <ul className="mt-2 divide-y divide-line rounded-xl bg-white ring-1 ring-line">
          {signals.slice(0, RECENT_SHOWN).map((s) => {
            const v = verdictFor(s.direction);
            const o = outcomeInWords(s.outcome);
            return (
              <li key={s.id} className="grid grid-cols-[5.5rem_3.5rem_1fr] items-center gap-2 px-4 py-2.5 text-[15px] sm:grid-cols-[6rem_4rem_6rem_1fr]">
                <span className="whitespace-nowrap text-muted">{fmtDay(s.createdAt)}</span>
                <a href={`/tickers/${s.ticker.symbol}`} className="font-medium hover:underline">
                  {s.ticker.symbol}
                </a>
                <span className={`hidden sm:block ${v.tone}`}>
                  {v.symbol} {s.direction === "neutral" ? "No call" : s.direction === "bullish" ? "Up" : "Down"}
                </span>
                <span className={`text-right ${o.tone}`}>
                  {o.mark} {o.text}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <details className="mt-8 rounded-xl bg-white p-5 ring-1 ring-line">
        <summary className="cursor-pointer text-[15px] font-medium">About these numbers</summary>
        <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
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

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-line">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-sm leading-snug text-muted">{label}</div>
    </div>
  );
}
