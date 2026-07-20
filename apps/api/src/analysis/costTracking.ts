import { prisma } from "@financial-adviser/shared";
import { countPromptTokens, TokenUsage } from "./claudeClient";
import { assembleContextForTicker } from "./promptAssembly";

// Sonnet 5 pricing (per the claude-api skill's cached table, checked 2026-07-19).
// Intro pricing runs through 2026-08-31; standard pricing applies after.
// Re-verify both numbers and the cutoff date if this drifts far from that date.
const INTRO_PRICING_CUTOFF = new Date("2026-09-01T00:00:00Z");
const PRICING = {
  intro: { inputPerMTok: 2.0, outputPerMTok: 10.0 },
  standard: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
};

function currentPricing(asOf: Date = new Date()) {
  return asOf < INTRO_PRICING_CUTOFF ? PRICING.intro : PRICING.standard;
}

export function estimateCostUsd(usage: TokenUsage, asOf: Date = new Date()): number {
  const pricing = currentPricing(asOf);
  return (usage.inputTokens / 1_000_000) * pricing.inputPerMTok + (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
}

/** Records actual usage/cost from a real Claude call -- called after every real generateSignal (C4). */
export async function recordUsage(tickerId: string, usage: TokenUsage): Promise<void> {
  await prisma.usageRecord.create({
    data: {
      tickerId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: estimateCostUsd(usage),
    },
  });
}

const DEFAULT_ASSUMED_OUTPUT_TOKENS = 500; // used only until real history exists

/** Average observed output tokens across all recorded runs, or a reasonable default if none exist yet. */
async function averageObservedOutputTokens(): Promise<number> {
  const agg = await prisma.usageRecord.aggregate({ _avg: { outputTokens: true } });
  return agg._avg.outputTokens ?? DEFAULT_ASSUMED_OUTPUT_TOKENS;
}

export interface CostEstimate {
  inputTokens: number;
  assumedOutputTokens: number;
  estimatedCostUsd: number;
  basedOnRealHistory: boolean;
}

/**
 * Real pre-run cost estimate (C4's AC: "shown before enabling a schedule").
 * Input tokens come from the free countTokens call against the actual
 * assembled prompt (no inference spent); output tokens are estimated from
 * this system's own historical average once enough real runs exist.
 */
export async function estimateRunCost(tickerSymbol: string): Promise<CostEstimate> {
  const context = await assembleContextForTicker(tickerSymbol);
  const inputTokens = await countPromptTokens(context.promptText);
  const recordCount = await prisma.usageRecord.count();
  const assumedOutputTokens = await averageObservedOutputTokens();

  const estimatedCostUsd = estimateCostUsd({ inputTokens, outputTokens: assumedOutputTokens });

  return {
    inputTokens,
    assumedOutputTokens,
    estimatedCostUsd,
    basedOnRealHistory: recordCount > 0,
  };
}

export interface SoftCapStatus {
  capUsd: number;
  spentUsd: number;
  exceeded: boolean;
}

/**
 * Checks cumulative spend since `since` against a soft cap. No per-user
 * scoping yet (Epic E not built) -- global for now, same placeholder
 * approach as C2's single API key; becomes a per-user query once accounts
 * exist.
 */
export async function checkSoftCap(capUsd: number, since: Date): Promise<SoftCapStatus> {
  const agg = await prisma.usageRecord.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { estimatedCostUsd: true },
  });
  const spentUsd = Number(agg._sum.estimatedCostUsd ?? 0);
  return { capUsd, spentUsd, exceeded: spentUsd > capUsd };
}
