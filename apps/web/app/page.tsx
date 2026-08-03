import { prisma, computeReachability } from "@financial-adviser/shared";
import { ReachabilityChip } from "./components/Reachability";
import { PipelineStatus } from "./components/PipelineStatus";

export const dynamic = "force-dynamic";

function directionColor(direction: string): string {
  if (direction === "bullish") return "text-bullish";
  if (direction === "bearish") return "text-bearish";
  return "text-neutralSignal";
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function WatchlistPage() {
  const [tickers, lastRun] = await Promise.all([
    prisma.ticker.findMany({
      orderBy: { symbol: "asc" },
      include: {
        signalRecords: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.pipelineRun.findFirst({
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const rows = await Promise.all(
    tickers.map(async (t) => {
      const latest = t.signalRecords[0];
      // A ticker whose newest signal predates the last run is one the run
      // failed on. Without this the row is indistinguishable from a fresh
      // one -- COIN sat here for a day showing a two-day-old bearish call as
      // though it were today's read, while the run that skipped it had
      // already finished. The banner said "1 failed"; nothing said WHICH.
      const stale = Boolean(latest && lastRun && latest.createdAt < lastRun.startedAt);
      const reachability = latest
        ? await computeReachability({
            tickerId: t.id,
            direction: latest.direction,
            targetPrice: latest.targetPrice ? Number(latest.targetPrice) : null,
            confidence: latest.confidence,
          })
        : null;
      return { ticker: t, latest, reachability, stale };
    })
  );

  return (
    <main>
      <PipelineStatus />

      {rows.length === 0 ? (
        <p className="text-muted">No tickers tracked yet.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map(({ ticker, latest, reachability, stale }) => (
            <li key={ticker.id}>
              <a
                href={`/tickers/${ticker.symbol}`}
                className="flex items-center justify-between py-5 hover:bg-white transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ticker.symbol}</span>
                    {reachability && <ReachabilityChip result={reachability} />}
                    {stale && (
                      <span className="rounded border border-neutralSignal/40 bg-neutralSignal/5 px-1.5 py-0.5 text-[11px] font-medium text-neutralSignal">
                        not updated
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted">{ticker.name ?? "—"}</div>
                </div>
                <div className="text-right">
                  {latest ? (
                    <>
                      <div
                        className={`font-medium capitalize ${
                          stale ? "text-muted" : directionColor(latest.direction)
                        }`}
                      >
                        {latest.direction}
                      </div>
                      <div className="text-sm text-muted">
                        {stale
                          ? `from ${fmtDate(latest.createdAt)} — last run failed for this ticker`
                          : `${latest.confidence}% direction confidence`}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted">No signal yet</div>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-muted">
        The chip beside each symbol estimates whether that signal&apos;s target price is actually
        reachable in 7 days; the figure on the right is Claude&apos;s confidence in the direction
        alone. See the <a href="/history" className="underline">track record</a> for how past signals
        resolved.
      </p>
    </main>
  );
}
