import { prisma } from "@financial-adviser/shared";
import { CitationRecord } from "./promptAssembly";
import { Signal } from "./claudeClient";

const ACCURACY_HORIZON_DAYS = 7; // A5's fixed accuracy-tracking horizon

/**
 * Persists a generated signal, resolving each short prompt-scoped citation ID
 * (e.g. "filing_0") to its real, durable source-record ID via the citation
 * map from the same prompt assembly -- the short ID itself means nothing
 * once this specific prompt run is gone.
 */
export async function persistSignal(
  tickerId: string,
  signal: Signal,
  rawConfidence: number,
  citationMap: Record<string, CitationRecord>,
  entryPrice: number | null
): Promise<void> {
  const targetDate = new Date();
  targetDate.setUTCDate(targetDate.getUTCDate() + ACCURACY_HORIZON_DAYS);

  await prisma.signalRecord.create({
    data: {
      tickerId,
      direction: signal.direction,
      confidence: signal.confidence,
      rawConfidence,
      rationale: signal.rationale,
      entryGuidance: signal.entryGuidance,
      targetPrice: signal.targetPrice,
      stopLossPrice: signal.stopLossPrice,
      // Captured now, not re-derived at grading time -- see the schema comment.
      entryPrice,
      targetDate,
      citations: {
        create: signal.citations
          .filter((id) => id in citationMap)
          .map((id) => ({
            sourceType: citationMap[id].type,
            sourceRecordId: citationMap[id].recordId,
          })),
      },
    },
  });
}
