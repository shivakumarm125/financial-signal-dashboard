import { prisma } from "@financial-adviser/shared";
import { PipelineStatus } from "./components/PipelineStatus";
import { loadMarketFacts, loadReliability } from "./lib/marketFacts";
import { verdictFor, factsInWords, fmtDay, fmtPrice, reliabilityInWords, weekChangeInWords } from "./lib/plain";

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

  return (
    <main>
      <PipelineStatus />

      <section className="mb-6 rounded-lg bg-white px-4 py-3 text-sm leading-relaxed ring-1 ring-line">
        <span className="font-medium">How reliable is this? </span>
        {reliabilityInWords(reliability.right, reliability.wrong)} Treat each call as one opinion, not advice.
      </section>

      {tickers.length === 0 ? (
        <p className="text-muted">No stocks added yet.</p>
      ) : (
        <ul className="space-y-3">
          {tickers.map((t) => {
            const latest = t.signalRecords[0];
            const f = facts.get(t.id);
            // A stock whose newest call predates the last update is one that
            // update failed on -- without saying so, an old call looks current.
            const stale = Boolean(latest && lastRun && latest.createdAt < lastRun.startedAt);
            const verdict = latest ? verdictFor(latest.direction) : null;
            const week = weekChangeInWords(f?.weekChangePct ?? null);
            const why = f ? factsInWords(f).slice(0, 2) : [];

            return (
              <li key={t.id}>
                <a
                  href={`/tickers/${t.symbol}`}
                  className="block rounded-xl bg-white p-5 ring-1 ring-line transition hover:ring-ink/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold">{t.symbol}</div>
                      <div className="truncate text-sm text-muted">{t.name ?? ""}</div>
                    </div>
                    {f?.price != null && (
                      <div className="text-right">
                        <div className="text-lg font-medium">{fmtPrice(f.price)}</div>
                        {week && <div className={`text-sm ${week.tone}`}>{week.text}</div>}
                      </div>
                    )}
                  </div>

                  {verdict ? (
                    <div
                      className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[15px] font-medium ${
                        stale ? "bg-line text-muted" : `${verdict.bg} ${verdict.tone}`
                      }`}
                    >
                      <span aria-hidden>{verdict.symbol}</span>
                      {verdict.label}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted">No call yet.</p>
                  )}

                  {stale && latest && (
                    <p className="mt-2 text-sm text-muted">
                      This call is from {fmtDay(latest.createdAt)} — the latest update missed this stock.
                    </p>
                  )}

                  {why.length > 0 && (
                    <ul className="mt-3 space-y-1 text-[15px] leading-snug text-ink/80">
                      {why.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}

                  <p className="mt-3 text-sm text-muted">See why →</p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
