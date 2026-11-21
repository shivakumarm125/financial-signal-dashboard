import { notFound } from "next/navigation";
import { prisma } from "@financial-adviser/shared";
import { PriceTrack } from "../../components/PriceTrack";
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
    // Only real calls: "no call" days would fill the list with rows that say nothing.
    where: { tickerId: ticker.id, direction: { not: "neutral" }, ...(latest ? { id: { not: latest.id } } : {}) },
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
  const target = latest?.targetPrice ? Number(latest.targetPrice) : null;
  const stop = latest?.stopLossPrice ? Number(latest.stopLossPrice) : null;
  const levels = latest ? levelsInWords(latest.direction, target, stop, latest.createdAt) : null;
  const week = weekChangeInWords(facts.weekChangePct);
  const seeing = factsInWords(facts);

  return (
    <main>
      <a href="/" className="text-[15px] text-muted hover:text-ink">
        Back to my stocks
      </a>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-lg">
          <span className="font-bold">{ticker.symbol}</span>
          <span className="ml-2 text-muted">{ticker.name}</span>
        </p>
        {facts.price !== null && (
          <p>
            <span className="text-lg font-semibold">{fmtPrice(facts.price)}</span>
            {week && <span className={`ml-2 text-sm ${week.tone}`}>{week.text}</span>}
          </p>
        )}
      </div>

      {latest && verdict ? (
        <section className="mt-4">
          <h1 className={`text-[2.6rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[3.25rem] ${verdict.tone}`}>
            {verdict.label}.
          </h1>
          <p className="mt-3 text-[15px] text-muted">
            {surenessFor(latest.confidence)}. Call made {fmtDay(latest.createdAt)} for the week to{" "}
            {fmtDay(addDays(latest.createdAt, HORIZON_DAYS))}.
          </p>

          {levels ? (
            <div className="mt-8 rounded-2xl bg-white px-5 pb-4 pt-5 sm:px-7">
              <PriceTrack
                direction={latest.direction}
                target={target}
                stop={stop}
                entry={latest.entryPrice ? Number(latest.entryPrice) : null}
                current={facts.price}
                large
              />
              <div className="mt-3 space-y-1 border-t border-line pt-4 text-[15px] leading-relaxed">
                <p>{levels.ifRight}</p>
                <p className="text-muted">{levels.ifWrong}</p>
              </div>
            </div>
          ) : (
            <p className="mt-6 max-w-[36rem] text-lg leading-relaxed">
              Nothing points clearly up or down right now, so there&apos;s no call this week.
            </p>
          )}
        </section>
      ) : (
        <h1 className="mt-4 text-[2.2rem] font-bold leading-tight tracking-[-0.02em] text-muted">No call yet.</h1>
      )}

      {seeing.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-bold tracking-[-0.01em]">What we&apos;re seeing</h2>
          <ul className="mt-3 space-y-2 text-[1.05rem] leading-relaxed">
            {seeing.map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" />
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {latest && (
        <details className="mt-8 rounded-2xl bg-white px-5 py-4 sm:px-7">
          <summary className="flex cursor-pointer items-center gap-2 text-[1.05rem] font-semibold">
            <span aria-hidden className="chevron inline-block text-muted">
              ›
            </span>
            Read the full reasoning
          </summary>
          <div className="mt-4 max-w-[38rem] font-serif text-[1.05rem] leading-[1.7]">
            <p>{latest.rationale}</p>
            {latest.entryGuidance && (
              <>
                <h3 className="mt-6 font-sans text-base font-semibold">Notes for people who trade</h3>
                <p className="mt-1">{latest.entryGuidance}</p>
              </>
            )}
          </div>
          {citedNews.length > 0 && (
            <>
              <h3 className="mt-6 text-base font-semibold">News it was based on</h3>
              <ul className="mt-2 space-y-1.5 text-[15px] text-muted">
                {citedNews.map((n) => (
                  <li key={n.id}>
                    {n.headline} <span className="whitespace-nowrap">({n.source})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-6 text-sm text-muted">Written by an AI model from prices, news, insider filings and forum posts.</p>
        </details>
      )}

      <section className="mt-12">
        <h2 className="text-xl font-bold tracking-[-0.01em]">How past calls on {ticker.symbol} turned out</h2>
        <p className="mt-1 max-w-[36rem] text-[15px] leading-relaxed text-muted">
          {reliabilityInWords(reliability.right, reliability.wrong)}
        </p>
        {pastCalls.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-2xl bg-white">
            {pastCalls.map((s) => {
              const v = verdictFor(s.direction);
              const o = outcomeInWords(s.outcome);
              return (
                <li key={s.id} className="grid grid-cols-[5.5rem_4.5rem_1fr] items-baseline gap-3 px-5 py-3 text-[15px] sm:px-7">
                  <span className="text-muted">{fmtDay(s.createdAt)}</span>
                  <span className={`font-medium ${v.tone}`}>
                    {s.direction === "neutral" ? "No call" : s.direction === "bullish" ? "Up" : "Down"}
                  </span>
                  <span className={`text-right ${o.tone}`}>{o.text}</span>
                </li>
              );
            })}
          </ul>
        )}
        <a href="/history" className="mt-3 inline-block text-[15px] text-muted underline underline-offset-4 hover:text-ink">
          See all past results
        </a>
      </section>

      {news.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-bold tracking-[-0.01em]">Latest news</h2>
          <ul className="mt-4 space-y-4">
            {news.map((n) => (
              <li key={n.id} className="max-w-[38rem] text-[1.05rem] leading-snug">
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {n.headline}
                  </a>
                ) : (
                  n.headline
                )}
                <div className="mt-0.5 text-sm text-muted">
                  {n.source}, {fmtDay(n.publishedAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
