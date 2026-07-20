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
| Social/forum speculation | **Reddit API** (OAuth "script" app type), targeting subreddits like r/wallstreetbets, r/stocks | Free tier, with caveats (see risks) | Reddit's API has gotten materially stricter since 2023 — free tier now has explicit rate limits and commercial-use restrictions that need re-checking against our actual usage pattern. | X/Twitter API — not pursued for MVP; Reddit alone satisfies the "fourth, more speculative signal" requirement from A1 without adding a second social integration. |

## Risks flagged for downstream tickets

1. **Reddit's current API terms need a real legal read, not an assumption**, before B4 is built — specifically whether our usage pattern (pulling mentions per ticker, storing them, showing them to users) stays inside Reddit's free-tier and commercial-use terms, especially if the product ever moves off "free beta." Flagging into A3.
2. **Free-tier rate limits are a moving target.** Whoever picks this ticket up for real implementation should re-verify current published limits for Alpha Vantage/Twelve Data and Finnhub at that time rather than trusting this doc's numbers indefinitely.

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document, together with A1, unblocks Epic B (Data Ingestion Pipeline) build start.*
