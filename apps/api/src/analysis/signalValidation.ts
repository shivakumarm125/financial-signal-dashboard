import { CitationRecord, PreTagDirection, PreTagDirections } from "./promptAssembly";
import { Signal } from "./claudeClient";

// A5 Q15: raw self-reported confidence is never published as-is. If the
// pre-tags (insider, price) and Claude's own stated direction all agree,
// confidence stands; if anything conflicts, cap it at a moderate ceiling
// regardless of what Claude claims.
const CONFLICT_CONFIDENCE_CEILING = 50;

/** Every citation in the signal must resolve to a real ID from this run's prompt (A5 Q18). */
export function validateCitations(citations: string[], citationMap: Record<string, CitationRecord>): boolean {
  return citations.every((id) => id in citationMap);
}

/**
 * Sanity-checks entry/target/stop-loss price ordering against the actual
 * current price (added 2026-07-19, alongside the buy/sell/stop-loss scope
 * change). A stop-loss on the wrong side of the current price for the
 * stated direction isn't a stylistic issue -- it's a real, dangerous
 * mistake to publish to someone who might act on it, so it's treated the
 * same as an invalid citation: malformed, triggers a retry.
 */
export function validateTradeLevels(
  direction: PreTagDirection,
  targetPrice: number | null,
  stopLossPrice: number | null,
  currentPrice: number | null
): boolean {
  if (currentPrice === null) return true; // nothing to validate against

  if (direction === "bullish") {
    if (stopLossPrice !== null && stopLossPrice >= currentPrice) return false;
    if (targetPrice !== null && targetPrice <= currentPrice) return false;
  }
  if (direction === "bearish") {
    if (stopLossPrice !== null && stopLossPrice <= currentPrice) return false;
    if (targetPrice !== null && targetPrice >= currentPrice) return false;
  }
  return true;
}

/**
 * Applies A5's confidence-capping rule: compares the insider pre-tag, the
 * price pre-tag, and Claude's own stated direction. Only non-neutral
 * pre-tags count as an opinion to agree/disagree with -- a pre-tag with no
 * real signal (no filings, ambiguous MAs) can't "conflict" with anything.
 */
export function capConfidence(claudeDirection: PreTagDirection, rawConfidence: number, preTags: PreTagDirections): number {
  const opinions = [preTags.insider, preTags.price].filter((d) => d !== "neutral");
  const allAgree = opinions.every((d) => d === claudeDirection);
  return allAgree ? rawConfidence : Math.min(rawConfidence, CONFLICT_CONFIDENCE_CEILING);
}

/** Applies A5 Q15's capping rule to a raw signal, returning the adjusted, publishable version. */
export function applyConfidenceCapping(signal: Signal, preTags: PreTagDirections): Signal {
  return {
    ...signal,
    confidence: capConfidence(signal.direction, signal.confidence, preTags),
  };
}
