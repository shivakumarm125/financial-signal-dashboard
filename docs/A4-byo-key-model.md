# A4 — BYO Claude-API-Key Model

**Status:** Draft — pending stakeholder sign-off
**Owner:** BA
**Last updated:** 2026-07-18
**Depends on:** [A1 — MVP Scope & Non-Goals](A1-mvp-scope.md)

## One-liner

Each user supplies and manages their own Claude API key — we never bill or proxy Claude usage. This doc specifies the full key lifecycle (collect → validate → store → use → fail → remove) that E2/E3/C2/C6 are built against.

## Key lifecycle

1. **Collection** — user pastes their Claude API key into the key-management UI (E3). Write-only field: once saved, the raw key is never re-displayed to the client.
2. **Storage** — encrypted at rest with **AES-256-GCM**, using a single application-level secret (from env/secrets manager, never committed to the repo). No KMS/envelope encryption — at ~10 users, per-record key rotation infrastructure isn't solving a real problem; if the app secret is ever compromised, rotating it and re-encrypting the (at most 10) stored keys is a manual, five-minute job, not an operational one.
3. **Validation** — happens **once**, at the moment a key is added or replaced (the "validate key" action in E3), not before every scheduled run. Validation calls the **actual model the analysis engine uses** (not a cheap throwaway model) with a minimal prompt — confirming not just "this key authenticates" but "this key can call the model we actually need." A schedule cannot be enabled until validation succeeds.
4. **Use** — C2 retrieves the decrypted key server-side at run time to call Claude for the real analysis (C1's assembled prompt). The key is never logged, never sent to the client, never appears in error messages verbatim.
5. **In-run failure** — handled by C6: transient errors (timeouts, momentary rate limits) retry with backoff; persistent failures (bad/revoked/rate-limited key) are treated as a distinct, user-facing failure state — not a silent skipped run.
6. **Failure notification** — **in-app only** for MVP (a status banner/badge on the dashboard). No email-sending infrastructure is built — the operator already has failure visibility via D4's job monitoring and can informally follow up with a friend/family member if a failure sits unacknowledged.
7. **Removal** — removing a key **auto-pauses** any active schedule tied to it. A schedule is never left "enabled" while guaranteed to fail every cycle; the in-app state reads as "paused — no key on file" rather than a recurring error.
8. **Replacement** — swapping to a new key re-runs step 3 (validation) before the schedule resumes.

## Cost/usage disclosure copy (MVP)

Shown before a user enables their first schedule:

> This tool uses your own Claude API key. Each scheduled run makes a small number of API calls billed to your Anthropic account — for a 10-ticker watchlist on a daily/weekly cadence, this is typically a small fraction of a cent to a few cents per run. Check **console.anthropic.com/settings/usage** to monitor your actual spend.

This is deliberately generic, not a computed dollar estimate — a real per-user estimate depends on A5's prompt-assembly shape and actual measured token counts, which don't exist until C1 is built. **C4 (per-user cost/usage guardrails)** remains the ticket to build a real computed estimate and a configurable soft cap, once that data exists; it is not blocked from starting, just from being *accurate* until then.

## Decisions log (from intake discussion)

| Question | Decision | Why |
|---|---|---|
| Storage encryption | AES-256-GCM, single app-level secret, no KMS | Envelope encryption solves a rotation-at-scale problem that doesn't exist at ~10 stored keys |
| Validation cadence | Once, at setup/key-change only | C6 already handles in-run failures reactively; a pre-flight ping before every run would double-bill a check that duplicates the real call |
| Validation target | The actual model the analysis engine calls | A key can authenticate but lack access to a specific model — validating against a cheap throwaway model wouldn't confirm the real path works |
| Cost disclosure | Generic text now, computed estimate later (C4) | Real estimate needs A5 + measured token counts; blocking A4 on that delays a small, low-stakes disclosure |
| Failure notification | In-app banner only, no email | No email infra to build for MVP; operator has D4 visibility and can informally follow up |
| Key removal | Auto-pause the schedule | A schedule guaranteed to fail every cycle has no informational value; a "paused, no key" state is clearer than a recurring failure |

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document unblocks E2/E3 (key storage/UI) and C2/C6 (Claude integration/retry handling) build start.*
