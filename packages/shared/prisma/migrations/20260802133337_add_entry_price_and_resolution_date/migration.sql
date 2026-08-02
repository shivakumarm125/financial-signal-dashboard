-- AlterTable
ALTER TABLE "backtest_signals" ADD COLUMN     "outcomeResolvedOn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "signal_records" ADD COLUMN     "entryPrice" DECIMAL(20,4),
ADD COLUMN     "outcomeResolvedOn" TIMESTAMP(3);
