# A5 — Signal Methodology Spec

**Status:** Draft — pending stakeholder sign-off
**Owner:** BA
**Last updated:** 2026-07-18
**Depends on:** [A1 — MVP Scope & Non-Goals](A1-mvp-scope.md), [A2 — Data-Source Vendor Evaluation](A2-vendor-evaluation.md)

## One-liner

Defines exactly what Claude is asked to produce per ticker per run, how the 4 data sources feed into it, and how the output is validated and later graded — the spec Epic C (C1–C6) is built directly against.

## Methodology: hybrid pre-tagging + LLM synthesis

Not a pure black-box LLM call, and not a fully deterministic scoring formula — a hybrid:

- **Insider filings** and **price/technicals** are objective, arithmetic data — pre-computed into a short structured tag before the prompt is assembled:
  - Insider filings: net buy/sell transaction count and net shares in the lookback window (e.g. "3 buys, 1 sell, net +12,000 shares, last 90 days").
  - Price/technicals: existing B2 outputs — e.g. "price above 50-day MA, volume trending up."
- **Financial news** and **social/forum speculation** are passed to Claude **raw** (headlines/summaries, post text) — no separate sentiment-scoring step. Sentiment is a nuance-reading task an LLM does better than a keyword heuristic, and a bad heuristic here would quietly feed Claude a wrong "fact" it then reasons on top of.
- The prompt instructs Claude on relative source reliability: insider filings and price data are concrete/public-record-backed; social speculation is unverified and should be heavily discounted; news sits in between.
- Claude performs the actual synthesis — it is not simply narrating a pre-computed score.

## Output schema

| Field | Shape | Notes |
|---|---|---|
| Direction | `bullish` \| `bearish` \| `neutral` | Three-way, not binary — see rationale below. |
| Confidence | 0–100 | Claude's self-reported number, **adjusted/capped** per the agreement rule below — never published raw. |
| Rationale | Text | Must include an explicit source-coverage statement (see below) and, if direction is `neutral`, must name the conflicting signals. |
| Citations | List of source-item IDs | Strict IDs only (e.g. `filing_003`, `news_012`) — no freeform citation text. |

### Why three-way direction, not binary

If the insider/price pre-tags disagree with Claude's own read of news/social, forcing a binary bullish/bearish pick — just with a suppressed confidence number — still nudges the user toward a lean that isn't really there. `neutral` lets a genuine conflict resolve honestly: "insider buying contradicts bearish price action — no clear read," rather than a manufactured direction.

### Confidence capping rule

Claude's raw self-reported confidence is **not** published as-is — LLM self-reported confidence is known to be poorly calibrated. Instead:

1. Compare the direction implied by the insider pre-tag, the price pre-tag, and Claude's own read of news/social.
2. If all signals agree, the self-reported confidence can stand (or reflect that agreement).
3. If signals conflict, confidence is capped at a moderate ceiling (e.g. 50) regardless of what Claude self-reports, and the rationale must name the conflict explicitly.

### Source-coverage acknowledgment

If a source had no data for this ticker/run (no filings in the window, no social mentions found), the rationale must say so explicitly — e.g. "No insider filings or social mentions found in this period; signal based on price action and news only." A confidence score should never look the same regardless of how many of the 4 sources actually had something to say.

### Citation validation

Every source item fed into the prompt (C1) carries an explicit ID. Claude's citations must be drawn only from that exact ID set. After the response returns, a post-check confirms every cited ID actually existed in that run's input — a citation to an ID that wasn't provided is treated as malformed output and triggers C3's existing retry path, exactly like a schema violation.

## Prompt bounding (when a ticker has more data than reasonably fits)

Most-recent-N per source, fixed caps (exact numbers tuned during C1 build, defaults below):

- News: last 10 items.
- Insider filings: last 5–10 in the lookback window.
- Social posts: last 20–30.

Recency is the proxy for relevance — a 6-month-old insider sale matters less than yesterday's. No separate relevance/quality ranking system; that would duplicate the reasoning Claude is already doing, the same reason news/social don't get a separate sentiment pre-tag.

## Model call parameters

**Low/near-zero temperature.** This is a fact-grounded structured-judgment task, not creative writing — the same inputs re-run shouldn't flip direction on sampling noise alone. A friend comparing two runs a day apart should see the *data* driving any change, not random phrasing or direction drift.

## Accuracy-tracking horizon (feeds C5/F3)

**Fixed at +7 days for every signal, every ticker.** This is the *grading* window — how far in the future C5 checks the actual price to log whether the signal was right — not the input lookback window (that's B8's concern, separate). A fixed horizon keeps the track record simple and comparable across tickers; a per-signal Claude-chosen horizon would make "is this tool actually any good" impossible to answer with one clean number.

## Example input → output pair

**Input (abridged, per-ticker context assembled by C1):**
```
Ticker: ACME
Insider pre-tag: 3 buys, 0 sells, net +8,500 shares, last 90 days (filing_041, filing_039, filing_033)
Price pre-tag: price above 50-day MA, volume trending up
News (raw, last 10): [news_101: "ACME beats Q2 revenue estimates, raises guidance"], [news_098: "ACME faces supplier delay concerns"], ...
Social (raw, last 20): [social_014: "ACME earnings looked solid but supply chain risk worries me"], ...
```

**Output:**
```json
{
  "direction": "bullish",
  "confidence": 72,
  "rationale": "Insider buying (3 purchases, net +8,500 shares in 90 days) and price action (above 50-day MA, rising volume) align with generally positive news coverage (raised guidance). Some social chatter flags supply-chain concerns, but this is unverified sentiment and does not contradict the concrete filing/price signals. All 4 sources had data this run.",
  "citations": ["filing_041", "filing_039", "filing_033", "news_101"]
}
```

If insider/price pre-tags had instead pointed bearish while news/social read bullish, the output would be `"direction": "neutral"`, confidence capped near 50, with the rationale naming the conflict directly.

## Sign-off

| Role | Name | Date |
|---|---|---|
| BA (author) | | 2026-07-18 |
| Stakeholder approval | | |

*Approval of this document unblocks C1–C6 (Claude Analysis Engine) build start.*
