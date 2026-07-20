# A6 — Journey Map (No Formal Personas)

**Status:** Draft — pending stakeholder sign-off
**Owner:** BA
**Last updated:** 2026-07-18
**Depends on:** [A1 — MVP Scope & Non-Goals](A1-mvp-scope.md)

## One-liner

Skips formal composite-persona work — the ~10 target users are real, known friends and family, not a hypothetical audience — and keeps only the part of A6 that's genuinely useful: an end-to-end journey map grounding F5's onboarding flow.

## Why no personas

Personas exist to give a design team a consistent stand-in for users they can't directly ask. That's not the situation here: the target users are specific people, reachable directly, with real (not invented) differences already roughly known — e.g. someone who'll check a couple of tickers casually vs. someone who wants more depth per signal. Writing composite named personas ("Busy Professional Dana") would be modeling people who can just be asked what they want.

## Journey map (signup → acting on a signal)

1. **Invite** — user receives an invite (out of band — text/email from the operator, not a public signup flow).
2. **Signup** — creates an account (E1).
3. **Add Claude key** — pastes their own Claude API key; key is validated once against the real model before anything else is enabled (A4).
4. **Build watchlist** — adds up to 10 tickers (F1), combined across markets (US-only per A1).
5. **Set schedule** — picks daily/weekly cadence, time, timezone (D2).
6. **First run** — waits for (or triggers) the first scheduled run; sees either a real signal or a clear "your first run is scheduled for X" state (F5, F6).
7. **Read a signal** — views the signal card (F2): direction, confidence, rationale (including source-coverage acknowledgment per A5), citations.
8. **Ongoing use** — periodically checks back; over time, sees historical accuracy (F3, once C5 has data) and can adjust watchlist/schedule (E4).

## Known usage-style variation (not formal personas)

- **Casual checker** — a couple of tickers, low engagement with detail, mainly wants the headline direction/confidence.
- **Detail-oriented user** — wants to read the full rationale and citations, may care about the historical accuracy view (F3) once it has data.

This distinction is worth keeping in mind for F2/F5 (collapsible detail view already accounts for this — F2's AC calls for a collapsible detail view, which serves both styles without needing separate designed paths).

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document satisfies A6 in place of formal persona deliverables.*
