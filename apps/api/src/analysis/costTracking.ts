import { prisma } from "@financial-adviser/shared";
import { countPromptTokens } from "./claudeClient";
import { estimateCostUsd } from "./usageRecording";

// Pricing, estimateCostUsd and recordUsage moved to usageRecording.ts so that
// claudeClient can record every call itself without a circular import.
// Re-exported here because callers and docs still reference these paths.
export { estimateCostUsd, recordUsage } from "./usageRecording";
import { assembleContextForTicker } from "./promptAssembly";


const DEFAULT_ASSUMED_OUTPUT_TOKENS = 500; // used only until real history exists

/**
 * Average observed output tokens across recorded LIVE SIGNAL runs, or a
 * reasonable default if none exist yet.
 *
 * Scoped to purpose "signal" deliberately: this figure estimates the cost of
 * the next scheduled signal, and backtest or key-validation calls have
 * different output profiles. Including them would quietly bias the estimate
 * toward whatever experiments happened to run last.
 */
async function averageObservedOutputTokens(): Promise<number> {
  const agg = await prisma.usageRecord.aggregate({
    where: { purpose: "signal" },
    _avg: { outputTokens: true },
  });
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
