-- DropForeignKey
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_tickerId_fkey";

-- AlterTable
ALTER TABLE "usage_records" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'signal',
ALTER COLUMN "tickerId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "usage_records_purpose_idx" ON "usage_records"("purpose");

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
