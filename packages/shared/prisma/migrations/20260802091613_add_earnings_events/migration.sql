-- CreateTable
CREATE TABLE "earnings_events" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hour" TEXT,
    "quarter" INTEGER,
    "year" INTEGER,
    "epsEstimate" DECIMAL(20,4),
    "epsActual" DECIMAL(20,4),
    "revenueEstimate" BIGINT,
    "revenueActual" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "earnings_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "earnings_events_tickerId_date_idx" ON "earnings_events"("tickerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_events_tickerId_date_key" ON "earnings_events"("tickerId", "date");

-- AddForeignKey
ALTER TABLE "earnings_events" ADD CONSTRAINT "earnings_events_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
