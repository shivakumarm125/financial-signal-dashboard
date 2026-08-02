import type { HitRateSummary } from "@financial-adviser/shared";

/**
 * Shared track-record rendering, used by both the global /history page and the
 * per-ticker panel. Kept in one place deliberately: two implementations of "how
 * we present a hit rate" is exactly the thing that drifts, and the caveats
 * below are the part that must never quietly go missing from one of them.
 */

/**
 * Below this many INDEPENDENT episodes, a hit rate is noise with a percent sign
 * on it, and is labelled as such rather than presented as a track record.
 */
export const MIN_MEANINGFUL_EPISODES = 10;

export const OUTCOME_LABELS: Record<string, string> = {
  hit_target: "Target hit",
  hit_stop: "Stopped out",
  ambiguous_same_day: "Both levels touched",
  expired_direction_correct: "Direction right, no level hit",
  expired_direction_wrong: "Direction wrong, no level hit",
  no_evaluation: "Not graded",
  pending: "Pending",
};

export function outcomeTone(outcome: string | null): string {
  if (outcome === "hit_target" || outcome === "expired_direction_correct") return "text-bullish";
  if (outcome === "hit_stop" || outcome === "expired_direction_wrong") return "text-bearish";
  return "text-muted";
}

export function directionColor(direction: string): string {
  if (direction === "bullish") return "text-bullish";
  if (direction === "bearish") return "text-bearish";
  return "text-neutralSignal";
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pluralDays(n: number): string {
  return n === 1 ? "1 distinct market day" : `${n} distinct market days`;
}

export function TrackRecordSummary({
  summary,
  pending,
}: {
  summary: HitRateSummary;
  pending?: number;
}) {
  const notGraded = summary.counts.no_evaluation ?? 0;

  return (
    <dl className="mt-4 space-y-2 text-sm">
      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="text-muted">Target / stop reached</dt>
        <dd>
          {summary.targetStopEvaluated} evaluated
          {summary.targetStopEvaluated > 0 && (
            <>
              {" — "}
              <span className="text-bullish">{summary.counts.hit_target ?? 0} hit target</span>,{" "}
              <span className="text-bearish">{summary.counts.hit_stop ?? 0} stopped out</span> (
              <span className="font-medium">{summary.targetHitRate}%</span>)
            </>
          )}
        </dd>
      </div>

      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="text-muted">Direction only (neither level hit)</dt>
        <dd>
          {summary.directionOnlyEvaluated} evaluated
          {summary.directionOnlyEvaluated > 0 && (
            <>
              {" — "}
              <span className="text-bullish">{summary.counts.expired_direction_correct ?? 0} correct</span>,{" "}
              <span className="text-bearish">{summary.counts.expired_direction_wrong ?? 0} wrong</span> (
              <span className="font-medium">{summary.directionAccuracy}%</span>)
            </>
          )}
        </dd>
      </div>

      <div className="flex justify-between gap-4 border-t border-line pt-2">
        <dt className="text-muted">Not graded (neutral or no levels set)</dt>
        <dd>{notGraded}</dd>
      </div>

      {pending !== undefined && (
        <div className="flex justify-between gap-4 border-t border-line pt-2">
          <dt className="text-muted">Still inside their 7-day horizon</dt>
          <dd>{pending}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Keeps a hit rate from overstating itself, in two separate ways.
 *
 * Overlap: four of the five live target/stop outcomes resolved on the same
 * 2026-07-31 down day -- one price move closing four signals is one test, not
 * four. Absolute size: the backtest's "100%" came from a single outcome, which
 * has no overlap problem at all and is still meaningless. Both need saying.
 */
export function IndependenceNote({ summary }: { summary: HitRateSummary }) {
  if (summary.targetStopEvaluated === 0) return null;

  const episodes = summary.distinctResolutionDays;
  const overlapping = summary.targetStopEvaluated > episodes;
  const tooSmall = episodes < MIN_MEANINGFUL_EPISODES;

  return (
    <p
      className={`mt-4 rounded border p-3 text-xs leading-relaxed ${
        overlapping || tooSmall
          ? "border-neutralSignal/40 bg-neutralSignal/5 text-ink"
          : "border-line bg-paper text-muted"
      }`}
    >
      {(overlapping || tooSmall) && <span className="font-medium">Read that hit rate carefully. </span>}
      {overlapping ? (
        <>
          Those {summary.targetStopEvaluated} outcomes resolved on only{" "}
          <span className="font-medium">{pluralDays(episodes)}</span> — several signals were closed
          out by the same single price move, so they are not independent tests. Treat it as roughly{" "}
          {episodes} {episodes === 1 ? "episode" : "episodes"}, not {summary.targetStopEvaluated}.
        </>
      ) : (
        <>
          {summary.targetStopEvaluated === 1
            ? "This 1 outcome resolved on "
            : `These ${summary.targetStopEvaluated} outcomes resolved across `}
          {pluralDays(episodes)}.
        </>
      )}
      {tooSmall && (
        <>
          {" "}
          At {episodes} {episodes === 1 ? "episode" : "episodes"} the percentage carries no real
          predictive weight — it needs at least {MIN_MEANINGFUL_EPISODES} independent ones before it
          means anything. Shown for transparency, not as a track record.
        </>
      )}
    </p>
  );
}

/** Shown in place of a summary when a ticker has produced no resolved signals at all. */
export function NoOutcomesYet({ pending, total }: { pending: number; total: number }) {
  return (
    <p className="mt-3 text-sm text-muted">
      {total === 0
        ? "No signals published for this ticker yet."
        : pending > 0
          ? `${total} signal${total === 1 ? "" : "s"} so far, ${pending} still inside the 7-day horizon — nothing has resolved yet.`
          : `${total} signal${total === 1 ? "" : "s"} so far, none with a target and stop to grade against.`}
    </p>
  );
}
