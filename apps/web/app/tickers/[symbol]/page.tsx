import { notFound } from "next/navigation";
import { prisma } from "@financial-adviser/shared";
import { loadMarketFacts, loadReliability } from "../../lib/marketFacts";
import {
  verdictFor,
  surenessFor,
  levelsInWords,
  outcomeInWords,
  reliabilityInWords,
  factsInWords,
  weekChangeInWords,
  fmtDay,
  fmtPrice,
  addDays,
  HORIZON_DAYS,
} from "../../lib/plain";

export const dynamic = "force-dynamic";

const PAST_CALLS_SHOWN = 8;

export default async function StockPage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) notFound();

  // Sequential on purpose: production allows one database connection.
  const latest = await prisma.signalRecord.findFirst({
    where: { tickerId: ticker.id },
    orderBy: { createdAt: "desc" },
    include: { citations: true },
  });
  const pastCalls = await prisma.signalRecord.findMany({
    where: { tickerId: ticker.id, ...(latest ? { id: { not: latest.id } } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAST_CALLS_SHOWN,
  });
  const news = await prisma.newsArticle.findMany({
    where: { tickerId: ticker.id },
    orderBy: { publishedAt: "desc" },
    take: 5,
  });
  const facts = (await loadMarketFacts([ticker.id])).get(ticker.id)!;
  const reliability = await loadReliability(ticker.id);

  const newsIds = latest?.citations.filter((c) => c.sourceType === "news").map((c) => c.sourceRecordId) ?? [];
  const citedNews = newsIds.length ? await prisma.newsArticle.findMany({ where: { id: { in: newsIds } } }) : [];

  const verdict = latest ? verdictFor(latest.direction) : null;
  const levels = latest
    ? levelsInWords(
        latest.direction,
        latest.targetPrice ? Number(latest.targetPrice) : null,
        latest.stopLossPrice ? Number(latest.stopLossPrice) : null,
        latest.createdAt
      )
    : null;
  const week = weekChangeInWords(facts.weekChangePct);
  const seeing = factsInWords(facts);

  return (
    <main>
      <p className="mb-6">
        <a href="/" className="text-sm text-muted hover:text-ink">
          ← My stocks
        </a>
      </p>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{ticker.name ?? ticker.symbol}</h1>
          <p className="text-muted">{ticker.symbol}</p>
        </div>
        {facts.price !== null && (
          <div className="text-right">
            <div className="text-2xl font-medium">{fmtPrice(facts.price)}</div>
            {week && <div className={`text-sm ${week.tone}`}>{week.text}</div>}
          </div>
        )}
      </div>

      {latest && verdict ? (
        <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-line">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-lg font-medium ${verdict.bg} ${verdict.tone}`}>
            <span aria-hidden>{verdict.symbol}</span>
            {verdict.label}
          </div>
          <p className="mt-2 text-sm text-muted">
            {surenessFor(latest.confidence)} · call made {fmtDay(latest.createdAt)}, for the week to{" "}
            {fmtDay(addDays(latest.createdAt, HORIZON_DAYS))}
          </p>

          {levels && (
            <div className="mt-4 space-y-1 text-[15px] leading-relaxed">
              <p>{levels.ifRight}</p>
              <p>{levels.ifWrong}</p>
            </div>
          )}
          {latest.direction === "neutral" && (
            <p className="mt-4 text-[15px] leading-relaxed">
              Nothing points clearly up or down right now, so no call this week.
            </p>
          )}
        </section>
      ) : (
        <p className="mt-6 text-muted">No call yet for this stock.</p>
      )}

      {seeing.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold">What we&apos;re seeing</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed">
            {seeing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {latest && (
        <details className="mt-6 rounded-xl bg-white p-5 ring-1 ring-line">
          <summary className="cursor-pointer text-[15px] font-medium">Read the full reasoning</summary>
          <p className="mt-3 text-[15px] leading-relaxed">{latest.rationale}</p>
          {latest.entryGuidance && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Notes for people who trade</h3>
              <p className="mt-1 text-[15px] leading-relaxed">{latest.entryGuidance}</p>
            </>
          )}
          {citedNews.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">News it was based on</h3>
              <ul className="mt-1 space-y-1 text-sm text-muted">
                {citedNews.map((n) => (
                  <li key={n.id}>
                    {n.source}: {n.headline}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-4 text-xs text-muted">Written by an AI model from prices, news, insider filings and forum posts.</p>
        </details>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold">How past calls on {ticker.symbol} turned out</h2>
        <p className="mt-1 text-[15px] text-muted">{reliabilityInWords(reliability.right, reliability.wrong)}</p>
        {pastCalls.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-xl bg-white ring-1 ring-line">
            {pastCalls.map((s) => {
              const v = verdictFor(s.direction);
              const o = outcomeInWords(s.outcome);
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[15px]">
                  <span className="whitespace-nowrap text-muted">{fmtDay(s.createdAt)}</span>
                  <span className={`flex-1 ${v.tone}`}>
                    {v.symbol} {s.direction === "neutral" ? "No call" : s.direction === "bullish" ? "Up" : "Down"}
                  </span>
                  <span className={`text-right ${o.tone}`}>
                    {o.mark} {o.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-sm">
          <a href="/history" className="text-muted underline hover:text-ink">
            See all past results
          </a>
        </p>
      </section>

      {news.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold">Latest news</h2>
          <ul className="mt-2 space-y-3">
            {news.map((n) => (
              <li key={n.id} className="text-[15px] leading-snug">
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {n.headline}
                  </a>
                ) : (
                  n.headline
                )}
                <div className="text-sm text-muted">
                  {n.source} · {fmtDay(n.publishedAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
