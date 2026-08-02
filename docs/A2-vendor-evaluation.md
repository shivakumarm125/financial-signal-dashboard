# A2 — Data-Source Vendor Evaluation & Selection

**Status:** Draft — pending stakeholder sign-off
**Owner:** BA
**Last updated:** 2026-07-18
**Depends on:** [A1 — MVP Scope & Non-Goals](A1-mvp-scope.md)

## One-liner

Four data feeds (price, insider filings, news, social) need a vendor pick each. This doc records the pick, the alternative considered, and why — so Epic B is built against named providers, not placeholders.

**Update (2026-07-18):** India cut from MVP scope — all India-specific vendor picks (NSE/BSE price wrapper, NSE/BSE filings parsing) removed below.

## Vendor picks

| Category | Pick | Cost | Notes / rate-limit shape | Alternative considered |
|---|---|---|---|---|
| US equities price/chart | **Alpha Vantage** (free tier) or Twelve Data free tier | Free | Free tiers are request-per-minute/day limited — fine for a scheduled batch job against a 10-ticker cap, not fine for real-time. Confirm exact current limits at implementation time (these shift). | Polygon.io / IEX Cloud paid — deferred; revisit only if free-tier limits actually block the daily/weekly batch job. |
| US insider filings | **SEC EDGAR direct** (`data.sec.gov` submissions/XBRL API) | Free | Official US government source — no vendor needed at all, just correct integration against EDGAR's own API and its documented rate limits. | N/A — this is the canonical source, not a vendor choice. |
| Financial news | **Finnhub free tier** (with NewsAPI as a fallback/supplement) | Free | Finnhub's free tier covers company news reasonably for US large/mid-caps. | Evaluating news as its own deeper multi-vendor comparison — deferred; default accepted for MVP speed. |
| Social/forum speculation | ~~Reddit API~~ → **StockTwits public streams API** (`/streams/symbol/{TICKER}.json`), switched 2026-08-02 | Free, no key and no app registration | No auth to lose; anonymous rate limit is undocumented and unheadered, so ingestion throttles conservatively. Different population from Reddit — retail day-traders rather than general forums, which is arguably *more* on-topic but also noisier. | Reddit — **the original pick, abandoned when the risk below materialised.** X/Twitter — still not pursued; one social integration satisfies A1's "fourth, more speculative signal". |

## Risks flagged for downstream tickets

1. ~~**Reddit's current API terms need a real legal read, not an assumption**, before B4 is built~~ — **this risk materialised on 2026-08-02 and closed the option entirely.** Reddit no longer offers self-serve app creation: attempting it returns only a pointer to the Responsible Builder Policy, gating API access behind a review process. There was never a chance to test whether our usage pattern sat inside the free tier, because there was no way to obtain credentials at all. Vendor switched to StockTwits, which needs no registration. The substance of the concern carries over unchanged — see the assumption tracked in A3 — it now just attaches to a different provider.
2. **StockTwits' terms carry the same untested assumption Reddit's did.** Its public streams endpoint is reachable without a key, which is not the same as a documented grant of rights to store and re-serve the content. Same posture as before: a small, free, invite-only tool, tracked rather than legally verified, re-checked if this takes on billing or grows. If B4's data ever becomes load-bearing rather than a fourth supporting signal, this deserves a real read.
2. **Free-tier rate limits are a moving target.** Whoever picks this ticket up for real implementation should re-verify current published limits for Alpha Vantage/Twelve Data and Finnhub at that time rather than trusting this doc's numbers indefinitely.

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document, together with A1, unblocks Epic B (Data Ingestion Pipeline) build start.*
