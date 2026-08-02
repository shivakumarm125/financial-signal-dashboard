-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'reddit',
    "subreddit" TEXT NOT NULL,
    "author" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "numComments" INTEGER NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "credibilityScore" INTEGER NOT NULL,
    "credibilityBasis" TEXT NOT NULL,
    "isUnverified" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_ingestion_state" (
    "id" TEXT NOT NULL,
    "tickerId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_ingestion_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_posts_tickerId_postedAt_idx" ON "social_posts"("tickerId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_tickerId_externalId_key" ON "social_posts"("tickerId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "social_ingestion_state_tickerId_key" ON "social_ingestion_state"("tickerId");

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_ingestion_state" ADD CONSTRAINT "social_ingestion_state_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "tickers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
