-- CreateTable
CREATE TABLE "signal_records" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "rawConfidence" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_citations" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,

    CONSTRAINT "signal_citations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signal_records_tickerId_createdAt_idx" ON "signal_records"("tickerId", "createdAt");

-- AddForeignKey
ALTER TABLE "signal_records" ADD CONSTRAINT "signal_records_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_citations" ADD CONSTRAINT "signal_citations_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "signal_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
