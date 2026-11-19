import { assembleContextForTicker, AssembledContext } from "./promptAssembly";
import { generateSignalsBatch, Signal } from "./claudeClient";
import { validateCitations, validateTradeLevels, applyConfidenceCapping } from "./signalValidation";
import { persistSignal } from "./signalHistory";
import type { UsagePurpose } from "./usageRecording";

// Retry once on a malformed response (invalid citation ID) -- per C3's AC,
// "malformed output triggers a retry, not a silent failure." Real API
// errors (auth/billing/rate-limit/connection) are returned immediately, not
// retried here -- that's C6's job, and retrying an auth failure gains
// nothing.
const MAX_ATTEMPTS = 2;

type ApiErrorStatus = "auth_error" | "billing_error" | "rate_limit_error" | "connection_error" | "other_error";

export type ValidatedSignalResult =
  | { status: "ok"; tickerSymbol: string; signal: Signal; rawConfidence: number }
  | { status: "malformed_output"; tickerSymbol: string; message: string }
  | { status: ApiErrorStatus; tickerSymbol: string; message: string };

export interface ValidationItem {
  /** Batch custom_id: ^[a-zA-Z0-9_-]{1,64}$, unique within the call. */
  key: string;
  context: AssembledContext;
  purpose: UsagePurpose;
}

export type ValidatedOutcome =
  | { status: "ok"; signal: Signal; rawConfidence: number }
  | { status: "malformed_output"; message: string }
  | { status: ApiErrorStatus; message: string };

function describeFailure(signal: Signal, context: AssembledContext, citationsOk: boolean): string {
  const invalidCitations = signal.citations.filter((id) => !(id in context.citationMap));
  return !citationsOk
    ? `cited unknown ID(s) [${invalidCitations.join(", ")}]`
    : `stop-loss/target price on the wrong side of current price ($${context.currentPrice}) for a ${signal.direction} call (target=${signal.targetPrice}, stopLoss=${signal.stopLossPrice})`;
}

/**
 * C2->C3 for many already-assembled prompts at once, via the half-price
 * Batches API. Each round submits only the items still needing an answer, so
 * the C3 retry costs one extra small batch rather than a full re-run. Applies
 * A5 Q15's confidence capping to every accepted signal. Shared by the live
 * pipeline and the backtest so both validate identically.
 */
export async function generateValidatedBatch(items: ValidationItem[]): Promise<Map<string, ValidatedOutcome>> {
  const outcomes = new Map<string, ValidatedOutcome>();
  let pending = items;
  const lastFailure = new Map<string, string>();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt++) {
    const results = await generateSignalsBatch(
      pending.map((i) => ({ customId: i.key, promptText: i.context.promptText, tickerId: i.context.tickerId, purpose: i.purpose }))
    );

    const retry: ValidationItem[] = [];
    for (const item of pending) {
      const result = results.get(item.key)!;
      if (result.status !== "ok") {
        outcomes.set(item.key, { status: result.status, message: result.message });
        continue;
      }

      const citationsOk = validateCitations(result.signal.citations, item.context.citationMap);
      const tradeLevelsOk = validateTradeLevels(
        result.signal.direction,
        result.signal.targetPrice,
        result.signal.stopLossPrice,
        item.context.currentPrice
      );

      if (citationsOk && tradeLevelsOk) {
        outcomes.set(item.key, {
          status: "ok",
          signal: applyConfidenceCapping(result.signal, item.context.preTagDirections),
          rawConfidence: result.signal.confidence,
        });
      } else {
        const reason = describeFailure(result.signal, item.context, citationsOk);
        lastFailure.set(item.key, reason);
        console.warn(`[C3] ${item.key}: attempt ${attempt} ${reason}, ${attempt < MAX_ATTEMPTS ? "retrying" : "giving up"}`);
        retry.push(item);
      }
    }
    pending = retry;
  }

  for (const item of pending) {
    outcomes.set(item.key, {
      status: "malformed_output",
      message: `Failed validation after ${MAX_ATTEMPTS} attempts: ${lastFailure.get(item.key)}`,
    });
  }
  return outcomes;
}

/**
 * Full C1->C2->C3 pipeline for the live job: assembles each ticker's prompt,
 * generates all signals in one batch, and persists the ones that validate.
 */
export async function generateValidatedSignals(symbols: string[]): Promise<ValidatedSignalResult[]> {
  const contexts = new Map<string, AssembledContext>();
  for (const symbol of symbols) contexts.set(symbol, await assembleContextForTicker(symbol));

  const outcomes = await generateValidatedBatch(
    symbols.map((symbol) => ({ key: `signal-${symbol}`, context: contexts.get(symbol)!, purpose: "signal" as const }))
  );

  const results: ValidatedSignalResult[] = [];
  for (const symbol of symbols) {
    const outcome = outcomes.get(`signal-${symbol}`)!;
    const context = contexts.get(symbol)!;
    if (outcome.status === "ok") {
      await persistSignal(context.tickerId, outcome.signal, outcome.rawConfidence, context.citationMap, context.currentPrice);
    }
    results.push({ ...outcome, tickerSymbol: symbol });
  }
  return results;
}
