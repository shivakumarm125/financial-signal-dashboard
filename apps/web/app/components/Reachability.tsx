import type { ReachabilityResult } from "@financial-adviser/shared";

function toneFor(score: number): string {
  if (score >= 50) return "border-bullish/40 text-bullish";
  if (score >= 25) return "border-neutralSignal/40 text-neutralSignal";
  return "border-line text-muted";
}

/** Compact chip for the watchlist — sits next to the ticker symbol. */
export function ReachabilityChip({ result }: { result: ReachabilityResult }) {
  if (!result.available) {
    return (
      <span
        className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
        title={result.reason}
      >
        no target
      </span>
    );
  }

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${toneFor(result.reachability)}`}
      title={`${result.confidence}% direction confidence x ${Math.round(
        result.conditionalBaseRate * 100
      )}% historical base rate for a ${(result.requiredMovePct * 100).toFixed(1)}% move`}
    >
      {result.reachability}% to target
    </span>
  );
}

/**
 * Full breakdown. Always shows both inputs, because they multiply to the score
 * — a reader should be able to check the arithmetic rather than trust it.
 */
export function ReachabilityDetail({ result }: { result: ReachabilityResult }) {
  if (!result.available) {
    return (
      <div className="rounded border border-line bg-paper p-4">
        <p className="text-xs uppercase tracking-wide text-muted">Target reachability</p>
        <p className="mt-2 text-sm text-muted">{result.reason}</p>
      </div>
    );
  }

  const basePct = Math.round(result.conditionalBaseRate * 100);

  return (
    <div className="rounded border border-line bg-paper p-4">
      <p className="text-xs uppercase tracking-wide text-muted">Target reachability</p>
      <p className={`mt-1 text-2xl font-medium ${toneFor(result.reachability).split(" ")[1]}`}>
        {result.reachability}%
      </p>
      <p className="mt-1 text-sm text-muted">
        Estimated chance the target is actually reached within 7 days.
      </p>

      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Direction confidence</dt>
          <dd>{result.confidence}%</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">
            Moved ≥{(result.requiredMovePct * 100).toFixed(1)}% when it moved this way at all
          </dt>
          <dd>
            {result.windowsReachingTarget} of {result.directionalWindows} ({basePct}%)
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-1 font-medium">
          <dt>
            {result.confidence}% × {basePct}%
          </dt>
          <dd>{result.reachability}%</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted">
        Base rate from {result.totalWindows} rolling 7-day windows of this ticker&apos;s own stored
        price history — not from this system&apos;s signal track record, which is still far too small
        to calibrate against (see <a href="/history" className="underline">track record</a>).
      </p>
    </div>
  );
}
