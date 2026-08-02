import { assembleContextForTicker } from "./promptAssembly";
import { generateSignal, Signal } from "./claudeClient";
import { validateCitations, validateTradeLevels, applyConfidenceCapping } from "./signalValidation";
import { recordUsage } from "./costTracking";
import { persistSignal } from "./signalHistory";

// Retry once on a malformed response (invalid citation ID) -- per C3's AC,
// "malformed output triggers a retry, not a silent failure." Real API
// errors (auth/rate-limit/connection) are returned immediately, not
// retried here -- that's C6's job, and retrying an auth failure gains
// nothing.
const MAX_ATTEMPTS = 2;

export type ValidatedSignalResult =
  | { status: "ok"; tickerSymbol: string; signal: Signal; rawConfidence: number }
  | { status: "malformed_output"; tickerSymbol: string; message: string }
  | { status: "auth_error" | "rate_limit_error" | "connection_error" | "other_error"; tickerSymbol: string; message: string };

/**
 * Full C1->C2->C3 pipeline for one ticker: assembles the prompt, calls
 * Claude, retries once on an invalid citation, then applies A5 Q15's
 * confidence-capping rule before returning the publishable signal.
 */
export async function generateValidatedSignal(symbol: string): Promise<ValidatedSignalResult> {
  const context = await assembleContextForTicker(symbol);

  let lastFailureReason = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateSignal(context.promptText);

    if (result.status !== "ok") {
      return { status: result.status, tickerSymbol: symbol, message: result.message };
    }

    // Record real usage/cost (C4) for every real call, valid or not -- an
    // invalid-citation retry still spent real tokens and should count.
    await recordUsage(context.tickerId, result.usage);

    const citationsOk = validateCitations(result.signal.citations, context.citationMap);
    const tradeLevelsOk = validateTradeLevels(
      result.signal.direction,
      result.signal.targetPrice,
      result.signal.stopLossPrice,
      context.currentPrice
    );

    if (citationsOk && tradeLevelsOk) {
      const finalSignal = applyConfidenceCapping(result.signal, context.preTagDirections);
      await persistSignal(
        context.tickerId,
        finalSignal,
        result.signal.confidence,
        context.citationMap,
        context.currentPrice
      );
      return {
        status: "ok",
        tickerSymbol: symbol,
        signal: finalSignal,
        rawConfidence: result.signal.confidence,
      };
    }

    const invalidCitations = result.signal.citations.filter((id) => !(id in context.citationMap));
    lastFailureReason = !citationsOk
      ? `cited unknown ID(s) [${invalidCitations.join(", ")}]`
      : `stop-loss/target price on the wrong side of current price ($${context.currentPrice}) for a ${result.signal.direction} call (target=${result.signal.targetPrice}, stopLoss=${result.signal.stopLossPrice})`;
    console.warn(`[C3] ${symbol}: attempt ${attempt} ${lastFailureReason}, ${attempt < MAX_ATTEMPTS ? "retrying" : "giving up"}`);
  }

  return {
    status: "malformed_output",
    tickerSymbol: symbol,
    message: `Failed validation after ${MAX_ATTEMPTS} attempts: ${lastFailureReason}`,
  };
}
