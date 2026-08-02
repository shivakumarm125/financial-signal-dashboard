-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT,
    "tickersAttempted" INTEGER NOT NULL DEFAULT 0,
    "signalsGenerated" INTEGER NOT NULL DEFAULT 0,
    "signalsFailed" INTEGER NOT NULL DEFAULT 0,
    "ingestionErrors" INTEGER NOT NULL DEFAULT 0,
    "outcomesUpdated" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_runs_startedAt_idx" ON "pipeline_runs"("startedAt");
