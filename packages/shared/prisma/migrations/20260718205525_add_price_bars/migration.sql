-- CreateTable
CREATE TABLE "price_bars" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(20,4) NOT NULL,
    "high" DECIMAL(20,4) NOT NULL,
    "low" DECIMAL(20,4) NOT NULL,
    "close" DECIMAL(20,4) NOT NULL,
    "volume" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_bars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_ingestion_state" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "lastBarDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_ingestion_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_bars_tickerId_date_idx" ON "price_bars"("tickerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "price_bars_tickerId_date_key" ON "price_bars"("tickerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "price_ingestion_state_tickerId_key" ON "price_ingestion_state"("tickerId");

-- AddForeignKey
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_ingestion_state" ADD CONSTRAINT "price_ingestion_state_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
