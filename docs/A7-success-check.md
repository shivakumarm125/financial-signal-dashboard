# A7 — Success Check (No Formal Instrumentation)

**Status:** Draft — pending stakeholder sign-off
**Owner:** BA
**Last updated:** 2026-07-18
**Depends on:** [A1 — MVP Scope & Non-Goals](A1-mvp-scope.md)

## One-liner

Skips a dedicated analytics/instrumentation pipeline and "instrumentation owner" role — at ~10 known users, most of what would be tracked is already sitting in the database as a byproduct of the product itself, and the rest is answerable by asking people directly.

## What's already captured, for free

| Signal | Where it already lives |
|---|---|
| Watchlist size | B5's schema (tickers per user) |
| Signal/directional accuracy over time | C5 (signal history & accuracy tracking) |
| Job success/failure rate | D4 (job monitoring & failure alerting) |
| "Is someone still using this" (retention proxy) | E1's session/last-login data |

No new event-tracking pipeline is built to get any of the above — it's read directly from what the product already stores for its own functioning.

## What isn't naturally captured, and how it's handled instead

- **Dashboard view rate** (did they actually open it, not just get notified) — not worth building an event-tracking system for 10 people. Answered qualitatively via I1's direct check-ins during onboarding, and informally afterward (the operator can just ask).
- **Whether the product "feels" useful/trustworthy** — inherently qualitative; a KPI dashboard wouldn't capture this better than asking does.

## Success review cadence

No instrumentation owner role. Informal periodic check-in (e.g. monthly, or whenever the operator talks to the group) covering: is anyone still actively using it, does the historical accuracy (once C5 has enough data) look reasonable, has anyone hit a confusing or broken moment. This is a conversation, not a dashboard.

## When this should change

If the product ever grows beyond friends and family, this is the first doc to redo as real KPI instrumentation — the same trigger noted in A3/A6 for their respective scale-downs.

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document satisfies A7 in place of formal KPI instrumentation.*
