-- AlterTable
ALTER TABLE "signal_records" ADD COLUMN     "entryGuidance" TEXT,
ADD COLUMN     "stopLossPrice" DECIMAL(20,4),
ADD COLUMN     "targetPrice" DECIMAL(20,4);
