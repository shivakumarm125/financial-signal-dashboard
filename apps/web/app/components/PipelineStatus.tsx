import { prisma } from "@financial-adviser/shared";

/**
 * Surfaces pipeline health where it will actually be seen (D4's "surfaces to
 * the user" half). Two distinct failure modes, because they look identical
 * from the dashboard otherwise:
 *
 *   - the last run FAILED or only partly succeeded, and
 *   - no run has happened at all recently.
 *
 * The second is the dangerous one. A cron that silently stops firing leaves
 * yesterday's signals sitting there looking perfectly current, and nothing
 * about the page would tell you they're stale.
 */

// The cron is weekdays-only, so a long weekend plus a bank holiday can
// legitimately reach ~4 days. Beyond that, something is wrong.
const STALE_AFTER_HOURS = 96;

function hoursSince(d: Date): number {
  return (Date.now() - d.getTime()) / 3_600_000;
}

function fmtAge(hours: number): string {
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export async function PipelineStatus() {
  const lastRun = await prisma.pipelineRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
  });

  if (!lastRun) {
    return (
      <div className="mb-6 rounded border border-line bg-paper p-3 text-xs text-muted">
        No pipeline run has been recorded yet. Signals on this page were generated before run
        tracking existed.
      </div>
    );
  }

  const age = hoursSince(lastRun.finishedAt!);
  const stale = age > STALE_AFTER_HOURS;
  const failed = lastRun.status === "failed";
  const partial = lastRun.status === "partial";

  if (!stale && !failed && !partial) {
    return (
      <p className="mb-6 text-xs text-muted">
        Last pipeline run {fmtAge(age)} — {lastRun.signalsGenerated} signal
        {lastRun.signalsGenerated === 1 ? "" : "s"} generated
        {lastRun.outcomesUpdated > 0 && `, ${lastRun.outcomesUpdated} outcome(s) resolved`}.
      </p>
    );
  }

  const tone = failed || stale ? "border-bearish/40 bg-bearish/5" : "border-neutralSignal/40 bg-neutralSignal/5";

  return (
    <div className={`mb-6 rounded border p-3 text-xs leading-relaxed ${tone}`}>
      <span className="font-medium">
        {failed
          ? "The last pipeline run failed."
          : partial
            ? "The last pipeline run only partly succeeded."
            : "Signals may be out of date."}
      </span>{" "}
      {stale && (
        <>
          The most recent completed run was {fmtAge(age)}, and the schedule is every weekday — the
          signals below may not reflect current prices or news.{" "}
        </>
      )}
      {!stale && (
        <>
          It finished {fmtAge(age)}: {lastRun.signalsGenerated} signal
          {lastRun.signalsGenerated === 1 ? "" : "s"} generated, {lastRun.signalsFailed} failed,{" "}
          {lastRun.ingestionErrors} ingestion error(s).{" "}
        </>
      )}
      {lastRun.detail && <span className="text-muted">{lastRun.detail}</span>}
    </div>
  );
}
