# Financial Signal Dashboard — Product Backlog

## Product decisions (locked in during intake)

| Decision | Answer |
|---|---|
| Product type | Multi-user **research/signal dashboard** — no trade execution, no brokerage integration |
| Markets | **US equities** (NYSE/NASDAQ) only for MVP — crypto/options/forex/other exchanges/geographies deferred |
| Data sources | Price/chart history · Financial news · Public insider filings (SEC Form 4) · Social/forum speculation (labeled unverified) |
| AI engine | Claude API — **each user supplies their own API key** (BYO key, not billed through us) |
| Watchlist cap | 10 tickers per user (MVP), combined across both markets |
| Frontend | Next.js / React |
| Backend | Node.js (Express/Nest) |
| Database | Postgres |
| Scheduling | Cloud cron / serverless job, daily or weekly, per-user configurable |
| Access & pricing | Free during beta, gated/invite access — no billing infrastructure built for MVP |
| Scale | **Max 10 users, friends and family only** — not a public beta. This scales down Epics A3/A8, H, I, and J; see those epics for specifics. |
| Output language | Called a **"signal"** / **"research note"**, never "prediction", in user-facing copy |
| MVP posture | Tight timeline, but all 4 data sources and both markets in scope from the start |
| Non-goals (MVP) | Auto-trading, brokerage order execution, backtesting engine, native mobile app, billing/subscriptions |

**Compliance note baked into the backlog:** "insider trading" data means public SEC filings only (Form 4 etc. — legally required disclosures). Social/forum data is treated explicitly as unverified speculation, not fact, and must be labeled as such in the UI.

Priority key: **P0** = must ship in MVP · **P1** = fast-follow, still targeted for first release window · **P2** = post-MVP backlog.

Tag legend: **BA** · **BE** (Backend Dev) · **FE** (Frontend Dev) · **UX** (UX Dev) · **QA** · **UXT** (UX Test Engineering)

---

## Epic A — Discovery, Architecture & Compliance `[BA]`

**A1. Define MVP scope & non-goals document** — P0 — ✅ **Drafted**, pending sign-off
- Write down the MVP cut (dashboard only, 4 data sources, BYO Claude key, no execution) and get explicit sign-off.
- AC: One-page doc listing in-scope/out-of-scope items, reviewed and approved before Epic B/C kick off.
- See [`docs/A1-mvp-scope.md`](docs/A1-mvp-scope.md).

**A2. Data-source vendor evaluation & selection** — P0 — ✅ **Drafted**, pending sign-off
- Evaluate providers for price/chart data (e.g. Polygon.io, Alpha Vantage), news (e.g. NewsAPI, Finnhub), and confirm SEC EDGAR full-text/Form 4 feed access.
- AC: Vendor comparison (cost, rate limits, data quality, ToS) with a recommendation per category; final picks documented in A1.
- See [`docs/A2-vendor-evaluation.md`](docs/A2-vendor-evaluation.md). Picks: Alpha Vantage/Twelve Data free tier (price), SEC EDGAR direct (filings), Finnhub free tier + NewsAPI fallback (news), Reddit API (social). Flags Reddit ToS for A3 legal review.

**A3. Lightweight disclaimer & data-use notice** — P0 — ✅ **Drafted**, pending sign-off — *(scaled down: ~10 friends-and-family users, no public launch, no billing — see note at end of Epic J)*
- Write a plain-language "not financial advice, use at your own risk" notice, plus a short note on the 4 data sources and known compliance assumptions (notably the Reddit non-commercial-use assumption tracked in A2). No formal ToS/Privacy Policy needed at this scale.
- AC: Disclaimer text shown at signup and on every prediction card; one short paragraph covering source attribution and tracked assumptions.
- See [`docs/A3-disclaimer-data-use.md`](docs/A3-disclaimer-data-use.md) — also folds in A8's public-data confirmation.

**A4. Define BYO Claude-API-key model** — P0 — ✅ **Drafted**, pending sign-off
- Specify how a user's key is collected, validated, stored, used, and what happens if it's invalid/rate-limited/revoked.
- AC: Written flow diagram covering key lifecycle + user-facing cost/usage disclosure copy (their key, their Anthropic bill).
- See [`docs/A4-byo-key-model.md`](docs/A4-byo-key-model.md). Decisions: AES-256-GCM storage (no KMS), validate once at setup against the real model, generic cost text now (real estimate deferred to C4), in-app-only failure notification, auto-pause schedule on key removal.

**A5. Signal methodology spec** — P0 — ✅ **Drafted**, pending sign-off
- Define exactly what Claude is asked to produce: signal direction, confidence score, rationale, and required source citations; how the 4 data sources are weighted/combined.
- AC: Spec document that Epic C is built directly against, including example input/output pairs.
- See [`docs/A5-signal-methodology.md`](docs/A5-signal-methodology.md). Decisions: hybrid pre-tagging (insider filings + price/technicals pre-tagged, news/social raw), three-way direction (bullish/bearish/neutral), confidence capped on pre-tag/Claude agreement, strict ID-based citations validated against input, most-recent-N prompt bounding, low temperature, fixed +7-day accuracy-tracking horizon.

**A6. Journey map (no formal personas)** — P1 — ✅ **Drafted**, pending sign-off — *(scaled down: real known users, not a hypothetical audience — see docs/A6)*
- AC: Primary end-to-end journey map from signup to acting on a signal. Formal 2-3 composite personas skipped — the ~10 target users are known, real friends/family, reachable directly.
- See [`docs/A6-journey-map.md`](docs/A6-journey-map.md).

**A7. Success check (no formal instrumentation)** — P1 — ✅ **Drafted**, pending sign-off — *(scaled down: no analytics pipeline or instrumentation owner — see docs/A7)*
- AC: What "success" means and how it's checked. Most signals (watchlist size, accuracy history, job success rate, retention proxy) already exist in the DB as a byproduct of B5/C5/D4/E1; the rest (view rate, felt usefulness) is answered via direct check-ins (I1), not a KPI dashboard.
- See [`docs/A7-success-check.md`](docs/A7-success-check.md).

**A8. Public-data sanity check** — P0 — ✅ **Drafted**, pending sign-off — *folded into A3, see [`docs/A3-disclaimer-data-use.md`](docs/A3-disclaimer-data-use.md)*
- Confirm each of the 4 ingested sources is genuinely public (SEC Form 4, public news APIs, public Reddit posts) — no non-public/insider channels involved — and that social speculation is clearly labeled unverified.
- AC: One paragraph in A3 confirming public-only status per source; no formal sign-off checklist needed at this scale.

---

## Epic B — Data Ingestion Pipeline `[BE]`

**B1. SEC EDGAR Form 4 ingestion service** — P0 — ✅ **Built**, verified against real data
- AC: Pulls insider filings per ticker on schedule, stores structured records (insider name/role, transaction type, shares, date), handles EDGAR rate limits.
- Implemented in `apps/api/src/ingestion/edgar/` (`packages/shared` Prisma schema: `Ticker`, `FilingIngestionState`, `InsiderFiling`). Ticker→CIK via cached `company_tickers.json`; incremental fetch with idempotent upsert; skip-and-log on unparseable filings; amendments stored as independent records (documented simplification); non-derivative transactions only for MVP (documented simplification). Verified end-to-end against live EDGAR + Supabase: AAPL — 590 filings, 1028 transaction records, correct officer/director/share/price/date fields.
- Run via `npm run ingest:filings --workspace=@financial-adviser/api -- AAPL MSFT ...`.

**B2. Market price/chart data ingestion service** — P0 — ✅ **Built**, verified against real data
- AC: Pulls OHLCV history + basic technicals (moving averages, volume trend) per ticker; backfills history on first add.
- Implemented in `apps/api/src/ingestion/twelvedata/` (`packages/shared` Prisma schema: `PriceBar`, `PriceIngestionState`). Vendor: Twelve Data (free tier, 8 req/min · 800/day — very tight, so exactly 1 API call per ticker per sync, backfill and incremental alike). 1-year backfill on first add; self-computed 50/200-day MA and 10d-vs-90d volume trend (no separate vendor indicator calls, conserving quota). Verified end-to-end: AAPL — 251 daily bars, correct date range, plausible MA/volume-trend output, on the first real API call (1 credit spent total).
- Run via `npm run ingest:prices --workspace=@financial-adviser/api -- AAPL MSFT ...`.

**B3. Financial news ingestion service** — P0 — ✅ **Built**, verified against real data
- AC: Pulls recent articles per ticker/company with source, timestamp, headline, summary; dedupes across runs.
- Implemented in `apps/api/src/ingestion/finnhub/` (`packages/shared` Prisma schema: `NewsArticle`, `NewsIngestionState`). Finnhub only for MVP — NewsAPI fallback dropped (its rationale was thin India coverage, now moot). 14-day backfill on first add (not a long window like price/filings — A5 only ever surfaces the most recent 10 items, so deep history has no use case here); incremental sync after that; dedup on Finnhub's own article ID. Verified against AAPL: 246 articles, correct headlines/sources/timestamps, zero duplicates. Note: Finnhub appears to silently cap results for extremely high-volume tickers (didn't return the full 14-day window for AAPL) — harmless given A5's most-recent-10 usage, but worth knowing.
- Run via `npm run ingest:news --workspace=@financial-adviser/api -- AAPL MSFT ...`.

**B4. Social/forum speculation ingestion service** — P1
- AC: Pulls relevant posts/mentions (e.g. Reddit, X) per ticker, tags each with a source-credibility score, explicitly flags as "unverified sentiment" in stored schema.

**B5. Data normalization & storage schema** — P0
- AC: Postgres schema covering tickers, watchlists, price history, news items, filings, social items, with FKs and indexes sized for per-user watchlist queries.

**B6. Per-ticker data freshness/staleness monitoring** — P1
- AC: Each stored record has a freshness timestamp; a stale-data flag surfaces if a source hasn't refreshed within its expected cadence.

**B7. Rate-limit & quota handling per provider** — P0
- AC: Each ingestion service backs off / queues on 429s, logs quota usage, and never silently drops a scheduled run.

**B8. Historical data backfill job** — P1
- AC: One-time job to pull N months of history for price/news/filings when a ticker is first watchlisted.

---

## Epic C — Claude Analysis Engine `[BE]`

**C1. Prompt/context assembly service** — P0 — ✅ **Built**, verified against real data
- AC: Combines latest price/news/filings/social data per ticker into a structured, size-bounded prompt per the A5 spec.
- Implemented in `apps/api/src/analysis/promptAssembly.ts`. Combines the 3 built sources (B1 filings pre-tagged as net buy/sell, B2 price/technicals pre-tagged, B3 news raw) — social (B4) not built yet, reported as a genuine coverage gap per A5's Q20, not a placeholder integration. Short sequential per-assembly citation IDs (Q1) mapping back to real DB rows. Verified against real AAPL data: correct net-share math (P/S codes only, excluding compensation codes M/F/G), correct MA/volume-trend pre-tag, correct citation map, correct source-coverage note.

**C2. Claude API integration layer (BYO key)** — P0 — ✅ **Built**, verified against real data
- AC: Retrieves the user's stored key securely at run time, calls Claude API, handles auth/rate-limit/timeout errors distinctly from data errors.
- Implemented in `apps/api/src/analysis/claudeClient.ts` using the official `@anthropic-ai/sdk`. Model: `claude-sonnet-5` (Q, model-choice discussion). Key retrieval is a placeholder env-var read for now (real per-user encrypted DB lookup deferred to E2, per C2 Q1) — structured as one swappable function. Structured outputs (`output_config.format` via `zodOutputFormat`) enforce A5's schema at the API level, replacing C1's earlier plain-text JSON instruction. Typed error classification: `AuthenticationError`→auth, `RateLimitError`→rate-limit, `APIConnectionError`→connection, `APIError`→other. **Correction to A5/Q19:** Sonnet 5 rejects non-default `temperature`/`top_p`/`top_k` (400) — adaptive thinking and default effort are used instead, since this is a scheduled batch call, not latency-sensitive. Verified end-to-end against the real AAPL prompt (C1's output): correct, nuanced signal (distinguished routine option-exercise/tax-withholding sells from discretionary insider selling), explicit missing-social-data acknowledgment, all citation IDs valid. 1 real API call spent on verification.

**C3. Signal output schema** — P0 — ✅ **Built**, verified against real data
- AC: Structured output enforced (direction, confidence 0-100, rationale text, list of cited source items); malformed output triggers a retry, not a silent failure.
- Schema enforcement itself lives in C2 (structured outputs). C3 adds: `apps/api/src/analysis/signalValidation.ts` — citation-ID validation (A5 Q18) and the confidence-capping rule (A5 Q15, comparing insider/price pre-tag directions against Claude's stated direction); `generateValidatedSignal.ts` — orchestrator that retries once on an invalid citation before giving up (not a silent failure). Verified end-to-end against real AAPL data: pre-tags disagreed (insider bearish, price bullish), so Claude's raw 58% confidence was correctly capped to 50% in the published signal — the capping rule visibly doing its job, not just passing synthetic tests.

**C4. Per-user cost/usage guardrails** — P1 — ✅ **Built**, verified against real data
- AC: Token/cost estimate shown before enabling a schedule; user-configurable soft cap with a warning notification.
- Implemented in `apps/api/src/analysis/costTracking.ts` (`packages/shared` Prisma schema: `UsageRecord`). Real pre-run estimate via the free `countTokens` API (no inference cost) against the actual assembled prompt, plus this system's own historical average output length once real runs exist (falls back to a documented default before that). Soft-cap check sums real recorded cost since a given date. No per-user scoping yet (Epic E not built) — tracked globally for now, same placeholder pattern as C2's single API key. Verified end-to-end: real call cost $0.011134 (2592 in / 595 out tokens), correctly recorded, and the pre-run estimate immediately started using the real 595-token average instead of the 500-token default.
- The A4/C2 "generic text now, real estimate later" deferral (A4 Q9) is resolved — this is the real estimate.

**C5. Prediction history & accuracy tracking** — P1
- AC: Each prediction is stored and later compared against actual price movement at a defined horizon (e.g. +7 days), surfaced as a track record.

**C6. Retry/fallback handling for Claude API failures** — P0 — ✅ **Built**, verified against real data
- AC: Transient errors retry with backoff; persistent failures (bad/revoked key) notify the user with a clear, actionable message rather than a generic error.
- Implemented in `apps/api/src/analysis/signalRetry.ts`. Leans on the Anthropic SDK's own internal retry-with-backoff for 429/5xx/connection errors (bumped to `maxRetries: 5` in `claudeClient.ts` — a batch job can afford more patience than an interactive one) rather than reinventing it; adds one outer retry (30s explicit wait) for anything still transient after that, then classifies the result into a clear actionable message: persistent auth failure, transient failure, or non-retryable error. Verified: pure classification logic tested against all 6 outcome branches (zero cost); the persistent-auth-failure path verified for real with a deliberately invalid key — a genuine 401 (no inference run, zero cost) correctly skipped the 30s transient-retry wait (2.5s elapsed) and produced the actionable message.

---

## Epic D — Scheduling & Notifications `[BE]`

**D1. Cloud cron/serverless job orchestration** — P0
- AC: Serverless scheduled job triggers the ingestion→analysis pipeline per user watchlist at their configured cadence (daily/weekly).

**D2. Per-user schedule preferences** — P0
- AC: User can set cadence (daily/weekly), time of day, and timezone; stored and respected by D1.

**D3. Email/in-app notification on new results** — P1
- AC: User is notified when a scheduled run completes with new predictions, linking directly to the results.

**D4. Job monitoring & failure alerting** — P0
- AC: Failed/skipped runs are logged and retried once automatically; repeated failure surfaces to the user and to an internal ops alert.

---

## Epic E — Auth, Accounts & API-Key Management `[BE + FE]`

**E1. User signup/login** — P0 `[BE]`
- AC: Standard email/password (or OAuth) auth, session handling, password reset flow.

**E2. Secure Claude API-key storage** — P0 `[BE]`
- AC: Keys encrypted at rest (e.g. envelope encryption), never logged, never returned to the client after initial save (write-only field).

**E3. API-key management UI** — P0 `[FE]`
- AC: User can add/replace/remove their Claude key; a "validate key" action confirms it works before enabling schedules.

**E4. Account settings page** — P1 `[FE]`
- AC: Single page to manage watchlist, schedule cadence/timezone, and notification preferences.

---

## Epic F — Dashboard UI `[FE + UX]`

**F1. Watchlist management screen** — P0 `[FE]`
- AC: Add/remove tickers, see at-a-glance last-run status per ticker.

**F2. Prediction card component** — P0 `[FE]`
- AC: Shows direction, confidence, rationale, cited sources, disclaimer text (per A3); collapsible detail view.

**F3. Historical prediction accuracy view** — P1 `[FE]`
- AC: Simple chart/table of past predictions vs. actual outcome per ticker (depends on C5).

**F4. Ticker detail view** — P0 `[FE]`
- AC: Tabbed view combining price chart, news feed, insider filings, and social signal for one ticker.

**F5. Onboarding flow** — P0 `[FE + UX]`
- AC: New user is guided through: enter/validate Claude key → build first watchlist → set schedule → see first prediction (or a clear "your first run is scheduled for X" state).

**F6. Empty/loading/error states** — P0 `[FE]`
- AC: Every async view (predictions loading, no data yet, provider error, stale data) has a designed, non-blank state.

---

## Epic G — Visual Design / Design System `[UX]`

**G1. Visual identity & style guide** — P0
- AC: Typography, color palette, spacing scale defined around a "simple, classy" direction (restrained color, generous whitespace, quiet data-forward UI) — approved by stakeholder before FE build starts.

**G2. Component design system (Figma)** — P0
- AC: Prediction card, ticker detail tabs, watchlist table, nav, charts specced and handed off to FE.

**G3. Responsive layout specs** — P1
- AC: Desktop-first layouts with defined tablet/mobile breakpoints for the dashboard and onboarding.

**G4. Accessibility design pass** — P1
- AC: Color contrast, focus states, and hit-target sizing checked against WCAG 2.1 AA at design stage (feeds into I2).

**G5. Landing/marketing page design** — P1
- AC: Pre-login page communicating what the product does and does not do (research tool, not advice), with a clear sign-up CTA.

---

## Epic H — QA `[QA]`

*Scaled down for ~10 friends-and-family users: no dedicated test-plan doc, mocked-provider suites, or ongoing cross-provider monitoring — real correctness bugs still matter (this touches people's money-adjacent decisions), so the pipeline and key security still get checked directly, just without the process ceremony.*

**H1. Core pipeline smoke test** — P0
- AC: Ingestion → analysis → scheduling exercised end-to-end at least once per data source, including at least one failure case per source (missing data, malformed payload, provider downtime), before enabling a schedule for any real user.

**H2. API-key security spot-check** — P0
- AC: Manual code review confirms keys are encrypted at rest, never logged, and never returned to the client after initial save.

---

## Epic I — UX Test Engineering `[UXT]`

*Cut for friends-and-family scale — with ~10 known users, ask them directly instead of running moderated usability studies, formal accessibility audits, or cross-browser/device test passes. Revisit if this ever grows beyond friends & family.*

**I1. Direct check-in during onboarding** — P0
- AC: When onboarding each real user, directly ask whether the API-key entry, watchlist setup, and first prediction made sense and felt trustworthy (folds in the intent of the former I1/I5); issues fed back to FE/UX informally.

---

## Epic J — Launch Readiness `[BA + QA]`

**Cut entirely (2026-07-18).** There is no public launch for a ~10-user friends-and-family tool — no beta cohort/rollout plan, no formal launch sign-off gate, no dedicated post-launch monitoring dashboard. A3/A8's lightweight compliance items stand on their own without a J2-style gate; ongoing job-failure visibility is already covered by D4.

---

## Suggested build sequence

1. **A1–A5, A8** (BA groundwork) unblock everything else.
2. **B1–B3, B5, B7** + **C1–C3, C6** (core pipeline + analysis, 3 sources) — the thinnest slice that produces a real prediction.
3. **E1–E3** (auth + key management) in parallel with step 2.
4. **D1–D2** (scheduling) once step 2 produces reliable output.
5. **F1, F2, F4–F6** + **G1–G2** (dashboard UI) against the same window.
6. **B4** (social speculation, 4th source) as a fast-follow once the 3-source pipeline is stable.
7. **H1–H2** (pipeline smoke test + key security check) before enabling any real user's schedule.
8. **I1** (direct check-in) during each user's onboarding — no formal beta/launch gate; Epic J is cut.
