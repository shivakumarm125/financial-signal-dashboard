import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance, reused across the api app (and any
// script entry points) rather than each caller instantiating its own.
export const prisma = new PrismaClient();

export * from "@prisma/client";
