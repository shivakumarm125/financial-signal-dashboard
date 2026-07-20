-- CreateTable
CREATE TABLE "tickers" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "cik" TEXT,
    "name" TEXT,
    "exchange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filing_ingestion_state" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "lastAccessionNumber" TEXT,
    "lastFilingDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filing_ingestion_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insider_filings" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "transactionIndex" INTEGER NOT NULL,
    "isAmendment" BOOLEAN NOT NULL DEFAULT false,
    "insiderName" TEXT NOT NULL,
    "insiderIsDirector" BOOLEAN NOT NULL DEFAULT false,
    "insiderIsOfficer" BOOLEAN NOT NULL DEFAULT false,
    "insiderOfficerTitle" TEXT,
    "insiderIsTenPercentOwner" BOOLEAN NOT NULL DEFAULT false,
    "transactionCode" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "sharesTransacted" DECIMAL(20,4) NOT NULL,
    "pricePerShare" DECIMAL(20,4),
    "filedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insider_filings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickers_symbol_key" ON "tickers"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "tickers_cik_key" ON "tickers"("cik");

-- CreateIndex
CREATE UNIQUE INDEX "filing_ingestion_state_tickerId_key" ON "filing_ingestion_state"("tickerId");

-- CreateIndex
CREATE INDEX "insider_filings_tickerId_transactionDate_idx" ON "insider_filings"("tickerId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "insider_filings_accessionNumber_transactionIndex_key" ON "insider_filings"("accessionNumber", "transactionIndex");

-- AddForeignKey
ALTER TABLE "filing_ingestion_state" ADD CONSTRAINT "filing_ingestion_state_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insider_filings" ADD CONSTRAINT "insider_filings_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
