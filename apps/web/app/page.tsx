import { prisma } from "@financial-adviser/shared";

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

  return (
    <main>
      {tickers.length === 0 ? (
        <p className="text-muted">No tickers tracked yet.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {tickers.map((t) => {
            const latest = t.signalRecords[0];
            return (
              <li key={t.id}>
                <a
                  href={`/tickers/${t.symbol}`}
                  className="flex items-center justify-between py-5 hover:bg-white transition-colors"
                >
                  <div>
                    <div className="font-medium">{t.symbol}</div>
                    <div className="text-sm text-muted">{t.name ?? "—"}</div>
                  </div>
                  <div className="text-right">
                    {latest ? (
                      <>
                        <div className={`font-medium capitalize ${directionColor(latest.direction)}`}>
                          {latest.direction}
                        </div>
                        <div className="text-sm text-muted">{latest.confidence}% confidence</div>
                      </>
                    ) : (
                      <div className="text-sm text-muted">No signal yet</div>
                    )}
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
