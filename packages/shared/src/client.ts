import { PrismaClient } from "@prisma/client";

/**
 * Single shared Prisma client instance, reused across the api app (and any
 * script entry points) rather than each caller instantiating its own.
 *
 * Cached on globalThis deliberately. Without this, every serverless function
 * instance -- and every hot reload in `next dev` -- constructs a fresh
 * PrismaClient with its own connection pool. Those pools are what exhausted
 * Supabase in production on 2026-08-02:
 *
 *   FATAL: (EMAXCONNSESSION) max clients reached in session mode
 *          - max clients are limited to pool_size: 15
 *
 * The module-scope const alone is not enough: module scope is per-instance, and
 * concurrent lambdas each get their own. globalThis caching at least stops a
 * single instance from multiplying clients across reloads and re-invocations.
 *
 * The other half of the fix is the connection string itself -- the web app must
 * point at Supabase's TRANSACTION-mode pooler (port 6543) with
 * `pgbouncer=true&connection_limit=1`, not session mode (port 5432). Session
 * mode's 15-client ceiling cannot support serverless fan-out no matter how the
 * client is constructed. Long-lived single-process callers (the D1 cron) are
 * fine on session mode and keep using it.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
