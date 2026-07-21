-- CreateTable
CREATE TABLE "backtest_signals" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "entryPrice" DECIMAL(20,4),
    "direction" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "rawConfidence" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "entryGuidance" TEXT,
    "targetPrice" DECIMAL(20,4),
    "stopLossPrice" DECIMAL(20,4),
    "outcome" TEXT NOT NULL,
    "outcomeDetail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backtest_signals_tickerId_asOfDate_idx" ON "backtest_signals"("tickerId", "asOfDate");

-- AddForeignKey
ALTER TABLE "backtest_signals" ADD CONSTRAINT "backtest_signals_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
