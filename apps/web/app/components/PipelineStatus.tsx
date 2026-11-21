import { prisma } from "@financial-adviser/shared";
import { fmtDay } from "../lib/plain";

/**
 * "When was this last updated, and did it work?" in one line.
 *
 * Two failure modes look identical from the dashboard otherwise: the last
 * update failed, or no update has happened at all recently. The second is the
 * dangerous one -- old signals keep looking current -- and it is exactly what
 * happened for two months from 2026-09-16, when a dead API key failed every
 * run. The technical detail stays in the pipeline_runs table and the GitHub run
 * summary; a reader here only needs to know whether to trust the dates.
 */

// Runs Mon/Wed/Fri, so a weekend gap is ~72h; a bank holiday can stretch it.
const STALE_AFTER_HOURS = 100;
const RUN_DAYS = [1, 3, 5]; // Mon, Wed, Fri (UTC), matching the workflow cron

function nextRunDay(from: Date): Date {
  const d = new Date(from);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (!RUN_DAYS.includes(d.getUTCDay()));
  return d;
}

export async function PipelineStatus() {
  const lastRun = await prisma.pipelineRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  const lastGood = await prisma.pipelineRun.findFirst({
    where: { finishedAt: { not: null }, status: { in: ["success", "partial"] } },
    orderBy: { startedAt: "desc" },
  });

  if (!lastRun) return null;

  const hours = (Date.now() - (lastGood?.finishedAt ?? lastRun.finishedAt!).getTime()) / 3_600_000;
  const stale = !lastGood || hours > STALE_AFTER_HOURS;
  const failed = lastRun.status === "failed";

  if (!stale && !failed) {
    return (
      <p className="text-[15px] text-muted">
        Updated {fmtDay(lastGood!.finishedAt!)}. Next update {fmtDay(nextRunDay(new Date()))}.
      </p>
    );
  }

  return (
    <p className="rounded-lg bg-bearish/10 px-4 py-3 text-[15px] leading-relaxed text-bearish">
      <span className="font-semibold">These may be out of date. </span>
      {lastGood ? (
        <>The last successful update was {fmtDay(lastGood.finishedAt!)}</>
      ) : (
        <>There hasn&apos;t been a successful update yet</>
      )}
      {failed ? ", and the most recent one didn't work." : "."}
    </p>
  );
}
