import { generateValidatedSignal, ValidatedSignalResult } from "./generateValidatedSignal";
import { Signal } from "./claudeClient";

// Categories that are worth retrying at all -- rate limits and connection
// blips are transient by nature. Auth failures (bad/revoked key) and
// malformed/other errors are not: retrying the identical request with the
// identical bad key gains nothing.
const TRANSIENT_STATUSES = new Set(["rate_limit_error", "connection_error"]);

// One additional attempt after the SDK's own internal retries (maxRetries: 5,
// see claudeClient.ts) are already exhausted -- a longer, explicit wait for
// whatever transient condition outlasted even that generous budget.
const OUTER_RETRY_DELAY_MS = 30_000;

export type SignalOutcome =
  | { status: "ok"; tickerSymbol: string; signal: Signal; rawConfidence: number }
  | {
      status: "persistent_auth_failure" | "transient_failure" | "non_retryable_error";
      tickerSymbol: string;
      actionableMessage: string;
      rawMessage: string;
    };

/**
 * Turns a raw pipeline result into a user-facing outcome. Pure function
 * (no I/O) so the message/category logic is testable without spending API
 * calls -- only the actual retry-and-wait behavior in generateSignalWithRetry
 * needs a real call to exercise.
 */
export function classifyOutcome(result: ValidatedSignalResult): SignalOutcome {
  if (result.status === "ok") return result;

  if (result.status === "auth_error") {
    return {
      status: "persistent_auth_failure",
      tickerSymbol: result.tickerSymbol,
      actionableMessage:
        "Your Claude API key appears to be invalid or has been revoked. Update it in your account settings to resume signals for this ticker.",
      rawMessage: result.message,
    };
  }

  if (TRANSIENT_STATUSES.has(result.status)) {
    return {
      status: "transient_failure",
      tickerSymbol: result.tickerSymbol,
      actionableMessage: "Claude's API is temporarily unavailable. This will be retried automatically on the next scheduled run.",
      rawMessage: result.message,
    };
  }

  // other_error / malformed_output -- neither is the user's key or a known
  // transient condition; surface it plainly rather than guessing at a cause.
  return {
    status: "non_retryable_error",
    tickerSymbol: result.tickerSymbol,
    actionableMessage: "Something went wrong generating this signal. This has been logged for investigation.",
    rawMessage: result.message,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full C6 wrapper: one outer retry (after a longer explicit wait) for
 * anything still transient once the SDK's own internal retries are spent,
 * then classifies whatever comes out into a clear, actionable outcome.
 */
export async function generateSignalWithRetry(symbol: string): Promise<SignalOutcome> {
  let result = await generateValidatedSignal(symbol);

  if (TRANSIENT_STATUSES.has(result.status)) {
    console.warn(`[C6] ${symbol}: transient failure (${result.status}) survived internal SDK retries, waiting ${OUTER_RETRY_DELAY_MS}ms then retrying once`);
    await sleep(OUTER_RETRY_DELAY_MS);
    result = await generateValidatedSignal(symbol);
  }

  return classifyOutcome(result);
}
