-- AlterTable
ALTER TABLE "signal_records" ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outcomeCheckedAt" TIMESTAMP(3),
ADD COLUMN     "outcomeDetail" TEXT;
