import { PrismaClient } from "@prisma/client";

// Connects as sentinel_app, which has no privileges of its own. Every query
// must run inside withRole(); anything outside one gets permission denied.
// Migrations use the owner URL passed on the command line, not this client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.SENTINEL_APP_DATABASE_URL ?? process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
