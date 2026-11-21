-- Which engine made each call. Existing rows were all made by Claude.
ALTER TABLE "signal_records" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'claude';
