import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";

// Allowlist, not a hint: the role name is interpolated into SET LOCAL ROLE,
// which cannot take a bind parameter.
export const DB_ROLES = [
  "sentinel_personnel",
  "sentinel_welfare_officer",
  "sentinel_commander",
  "sentinel_admin",
  "sentinel_scoring",
] as const;

export type DbRole = (typeof DB_ROLES)[number];

// Prisma's own type; re-deriving the exclusion by hand broke inference.
export type Tx = Prisma.TransactionClient;

// Runs fn in one transaction scoped to a single role and identity. SET LOCAL
// is transaction-scoped and Prisma pins the transaction to one connection, so
// neither leaks into another request under pooling.
export async function withRole<T>(
  role: DbRole,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!DB_ROLES.includes(role)) {
    throw new Error(`refusing to set unknown database role: ${role}`);
  }

  return prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    await tx.$executeRaw`SELECT set_config('sentinel.user_id', ${userId ?? ""}, true)`;
    return fn(tx);
  });
}
