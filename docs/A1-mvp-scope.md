# A1 — MVP Scope & Non-Goals

**Status:** Draft — pending stakeholder sign-off (blocks Epic B / Epic C kickoff per ticket AC)
**Owner:** BA
**Last updated:** 2026-07-19

## One-liner

A multi-user research dashboard that turns price history, news, public insider filings, and social speculation into a scheduled, cited *signal* per ticker — not a trading tool, and never presented as a guaranteed prediction.

**Update (2026-07-18):** India was cut from MVP scope entirely (not deferred-as-provisional — removed). All product decisions below reflect US-only equities.

**Update (2026-07-19):** Signals now include explicit buy/sell/stop-loss price guidance, a deliberate decision (not a drift) to move the product further toward actionable trading guidance than originally scoped — see `docs/A3-disclaimer-data-use.md`'s matching update. **The "no trade execution" non-goal below is unchanged and still holds**: the product suggests price levels for the user's own consideration; it does not place orders, connect to a brokerage, or execute anything. That's the boundary being held even as the advice-content itself becomes more concrete.

## In scope (MVP)

| Area | Decision |
|---|---|
| Product shape | Signal/research dashboard only. No trade execution, no brokerage order placement. |
| Markets | **US equities** (NYSE/NASDAQ) only. No crypto, options, forex, or other exchanges/geographies — those are explicitly deferred. |
| Data sources | (1) Price/chart history + basic technicals, (2) financial news, (3) public insider filings, (4) social/forum speculation. |
| Insider filings | SEC Form 4 via SEC EDGAR. |
| AI engine | Claude API. Each user supplies and manages their **own** API key; we never bill or proxy Claude usage. |
| Watchlist | Capped at **10 tickers per user** (combined across both markets) for MVP. |
| Scheduling | Daily or weekly, user-configurable cadence and time, run via cloud cron/serverless — not real-time/intraday. |
| Access & pricing | Free during beta; no billing/subscription infrastructure built for MVP. Access is gated (invite/beta list), not open self-serve signup. |
| User-facing language | Output is called a **"signal"** or **"research note"** with a confidence score — the word "prediction" is avoided in UI copy. Ties directly into the A3 disclaimer work. |
| Stack | Next.js (frontend), Node.js/Express or Nest (backend), Postgres. |

## Out of scope (MVP) — explicit non-goals

- Trade execution or brokerage integration of any kind (including "confirm to send" flows).
- Backtesting engine / strategy simulation.
- Native mobile app (web-responsive only).
- Any market beyond US equities (crypto, options, forex, other exchanges, other geographies including India) — noted as a deliberate later-phase extension, not a rejection.
- Paid tiers, subscriptions, or billing (BYO Claude key means we don't need to meter Claude usage; if we ever charge for the product itself, that's a separate future epic).
- Multi-language localization.
- Real-time/streaming data — the product is batch/scheduled by design.

## Open risks flagged for downstream epics (not resolved by this doc)

None currently flagged — the multi-market risks previously listed here (dual-market Epic B scope, a second insider-filing vendor, SEBI advice-regulation exposure, dual market-calendar scheduling) are moot now that India is out of MVP scope.

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document unblocks Epic B (Data Ingestion) and Epic C (Claude Analysis Engine).*
