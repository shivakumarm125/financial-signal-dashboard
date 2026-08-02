import { prisma, computeReachability } from "@financial-adviser/shared";
import { ReachabilityChip } from "./components/Reachability";
import { PipelineStatus } from "./components/PipelineStatus";

export const dynamic = "force-dynamic";

function directionColor(direction: string): string {
  if (direction === "bullish") return "text-bullish";
  if (direction === "bearish") return "text-bearish";
  return "text-neutralSignal";
}

export default async function WatchlistPage() {
  const tickers = await prisma.ticker.findMany({
    orderBy: { symbol: "asc" },
    include: {
      signalRecords: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const rows = await Promise.all(
    tickers.map(async (t) => {
      const latest = t.signalRecords[0];
      const reachability = latest
        ? await computeReachability({
            tickerId: t.id,
            direction: latest.direction,
            targetPrice: latest.targetPrice ? Number(latest.targetPrice) : null,
            confidence: latest.confidence,
          })
        : null;
      return { ticker: t, latest, reachability };
    })
  );

  return (
    <main>
      <PipelineStatus />

      {rows.length === 0 ? (
        <p className="text-muted">No tickers tracked yet.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map(({ ticker, latest, reachability }) => (
            <li key={ticker.id}>
              <a
                href={`/tickers/${ticker.symbol}`}
                className="flex items-center justify-between py-5 hover:bg-white transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ticker.symbol}</span>
                    {reachability && <ReachabilityChip result={reachability} />}
                  </div>
                  <div className="text-sm text-muted">{ticker.name ?? "—"}</div>
                </div>
                <div className="text-right">
                  {latest ? (
                    <>
                      <div className={`font-medium capitalize ${directionColor(latest.direction)}`}>
                        {latest.direction}
                      </div>
                      <div className="text-sm text-muted">{latest.confidence}% direction confidence</div>
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
