/*
  Warnings:

  - You are about to drop the column `numComments` on the `social_posts` table. All the data in the column will be lost.
  - You are about to drop the column `score` on the `social_posts` table. All the data in the column will be lost.
  - You are about to drop the column `subreddit` on the `social_posts` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `social_posts` table. All the data in the column will be lost.
  - Made the column `body` on table `social_posts` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "social_posts" DROP COLUMN "numComments",
DROP COLUMN "score",
DROP COLUMN "subreddit",
DROP COLUMN "title",
ADD COLUMN     "authorFollowers" INTEGER,
ADD COLUMN     "authorJoinedAt" TIMESTAMP(3),
ADD COLUMN     "authorOfficial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "authorPostCount" INTEGER,
ADD COLUMN     "declaredSentiment" TEXT,
ALTER COLUMN "platform" SET DEFAULT 'stocktwits',
ALTER COLUMN "body" SET NOT NULL;
