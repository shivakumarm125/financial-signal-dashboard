-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_records_createdAt_idx" ON "usage_records"("createdAt");

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
