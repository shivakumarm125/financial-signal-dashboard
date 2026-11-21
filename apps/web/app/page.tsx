import { prisma } from "@financial-adviser/shared";
import { PipelineStatus } from "./components/PipelineStatus";
import { PriceTrack } from "./components/PriceTrack";
import { loadMarketFacts, loadReliability } from "./lib/marketFacts";
import {
  verdictFor,
  factsInWords,
  fmtDay,
  fmtPrice,
  reliabilityInWords,
  weekChangeInWords,
  weekHeadline,
} from "./lib/plain";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tickers = await prisma.ticker.findMany({
    orderBy: { symbol: "asc" },
    include: { signalRecords: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const lastRun = await prisma.pipelineRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  const facts = await loadMarketFacts(tickers.map((t) => t.id));
  const reliability = await loadReliability();

  const rows = tickers.map((t) => {
    const latest = t.signalRecords[0];
    // A stock whose newest call predates the last update is one that update
    // failed on -- without saying so, an old call looks current.
    const stale = Boolean(latest && lastRun && latest.createdAt < lastRun.startedAt);
    return { t, latest, stale, f: facts.get(t.id) };
  });
  const current = rows.filter((r) => r.latest && !r.stale).map((r) => r.latest!.direction);

  return (
    <main>
      <h1 className="max-w-[16ch] text-[2.6rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[3.25rem]">
        {weekHeadline(current)}
      </h1>
      <div className="mt-4">
        <PipelineStatus />
      </div>

      <aside className="mt-6 max-w-[36rem] border-l-[3px] border-neutralSignal pl-4 text-[15px] leading-relaxed">
        {reliabilityInWords(reliability.right, reliability.wrong)} Treat each call as one opinion, not advice.
      </aside>

      {rows.length === 0 ? (
        <p className="mt-10 text-muted">No stocks added yet. Add one from Manage to get its first call.</p>
      ) : (
        <ul className="mt-10 divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_#D9E0DA]">
          {rows.map(({ t, latest, stale, f }) => {
            const verdict = latest ? verdictFor(latest.direction) : null;
            const week = weekChangeInWords(f?.weekChangePct ?? null);
            const why = f ? factsInWords(f).slice(0, 2) : [];

            return (
              <li key={t.id}>
                <a href={`/tickers/${t.symbol}`} className="block px-5 py-6 transition-colors hover:bg-mist/60 sm:px-7">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-xl font-bold tracking-[-0.01em]">{t.symbol}</span>
                      <span className="ml-2 truncate text-[15px] text-muted">{t.name ?? ""}</span>
                    </div>
                    {f?.price != null && (
                      <div className="shrink-0 text-right">
                        <span className="text-lg font-semibold">{fmtPrice(f.price)}</span>
                        {week && <span className={`ml-2 text-sm ${week.tone}`}>{week.text}</span>}
                      </div>
                    )}
                  </div>

                  {verdict ? (
                    <p className={`mt-3 text-[1.35rem] font-semibold leading-tight ${stale ? "text-muted" : verdict.tone}`}>
                      <span aria-hidden className="mr-1.5 text-base align-middle">
                        {verdict.symbol}
                      </span>
                      {verdict.label}
                    </p>
                  ) : (
                    <p className="mt-3 text-muted">No call yet.</p>
                  )}

                  {stale && latest && (
                    <p className="mt-1 text-sm text-muted">
                      This call is from {fmtDay(latest.createdAt)}. The latest update missed this stock.
                    </p>
                  )}

                  {latest && !stale && (
                    <PriceTrack
                      direction={latest.direction}
                      target={latest.targetPrice ? Number(latest.targetPrice) : null}
                      stop={latest.stopLossPrice ? Number(latest.stopLossPrice) : null}
                      entry={latest.entryPrice ? Number(latest.entryPrice) : null}
                      current={f?.price ?? null}
                    />
                  )}

                  {why.length > 0 && (
                    <ul className="mt-3 space-y-0.5 text-[15px] leading-snug text-muted">
                      {why.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
