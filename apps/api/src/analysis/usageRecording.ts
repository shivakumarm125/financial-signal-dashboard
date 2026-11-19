import { prisma } from "@financial-adviser/shared";

/**
 * Cost recording, split out of costTracking.ts so `claudeClient` can call it.
 *
 * costTracking imports countPromptTokens FROM claudeClient, so if claudeClient
 * imported recordUsage from costTracking the two would form a cycle. This
 * module imports nothing but prisma, and takes a structural token shape rather
 * than claudeClient's TokenUsage type, which keeps the dependency one-way.
 */

// Sonnet 5 pricing (per the claude-api skill's cached table, checked 2026-07-19).
// Intro pricing runs through 2026-08-31; standard pricing applies after.
// Re-verify both numbers and the cutoff date if this drifts far from that date.
const INTRO_PRICING_CUTOFF = new Date("2026-09-01T00:00:00Z");
const PRICING = {
  intro: { inputPerMTok: 2.0, outputPerMTok: 10.0 },
  standard: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

function currentPricing(asOf: Date = new Date()) {
  return asOf < INTRO_PRICING_CUTOFF ? PRICING.intro : PRICING.standard;
}

// Message Batches API bills every token at half the standard rate.
const BATCH_DISCOUNT = 0.5;

export function estimateCostUsd(usage: TokenCounts, asOf: Date = new Date(), opts: { batch?: boolean } = {}): number {
  const pricing = currentPricing(asOf);
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
  return opts.batch ? cost * BATCH_DISCOUNT : cost;
}

/** What the call was for. Keeps backtest spend from being mistaken for live-signal spend. */
export type UsagePurpose = "signal" | "backtest" | "adhoc";

/**
 * Records a real Claude call.
 *
 * Called from `claudeClient.generateSignal` itself, so it fires for EVERY real
 * call regardless of who made it. It previously lived in
 * generateValidatedSignal, which meant two whole categories of spend went
 * unrecorded: every backtest call (runBacktest calls generateSignal directly --
 * a 10-point backtest is 10 unrecorded calls) and every ad-hoc or debugging
 * call. Cost figures that quietly exclude the expensive experiments are worse
 * than no cost figures.
 *
 * `tickerId` is nullable so a call with no ticker context still gets counted
 * rather than being dropped for want of a foreign key.
 */
export async function recordUsage(
  usage: TokenCounts,
  opts: { tickerId?: string | null; purpose?: UsagePurpose; batch?: boolean } = {}
): Promise<void> {
  await prisma.usageRecord.create({
    data: {
      tickerId: opts.tickerId ?? null,
      purpose: opts.purpose ?? "adhoc",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: estimateCostUsd(usage, new Date(), { batch: opts.batch }),
    },
  });
}
