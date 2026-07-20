-- CreateTable
CREATE TABLE "news_articles" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_ingestion_state" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "lastSyncedDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_ingestion_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "news_articles_tickerId_publishedAt_idx" ON "news_articles"("tickerId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_tickerId_externalId_key" ON "news_articles"("tickerId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "news_ingestion_state_tickerId_key" ON "news_ingestion_state"("tickerId");

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_ingestion_state" ADD CONSTRAINT "news_ingestion_state_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
