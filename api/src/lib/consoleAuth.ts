import { verifyPassword } from "@/lib/password";
import { isConsoleRole, type ConsoleSession } from "@/lib/session";
import { withRole } from "@/lib/withRole";

// Sign-in for the Welfare Console.
//
// It reads the same credential table as the PWA and applies the mirror-image
// rule: the PWA rejects anyone who is not PERSONNEL, and this rejects anyone
// who is. One password database, two doors, neither of which opens onto the
// other's building.
//
// Runs as sentinel_auth, which can read PersonnelCredential and User and holds
// no privilege on any welfare table. A flaw in this file cannot become a data
// leak, because there is nothing reachable from here to leak.
//
// (The table is still named PersonnelCredential, which is now half a misnomer —
// it holds staff logins too. Renaming it is a migration with no behavioural
// payoff, so it is left alone and noted here instead.)

type CredentialRow = {
  userId: string;
  passwordHash: string;
  role: string;
};

// A real scrypt hash of a value nobody knows. Verifying against it costs the
// same work as a genuine check, so a missing login and a wrong password take
// the same time. Without it, a fast rejection announces "no such officer".
const DECOY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function signIn(
  loginId: string,
  password: string,
): Promise<ConsoleSession | null> {
  const id = loginId.trim();
  if (!id || !password) {
    await verifyPassword(password, DECOY_HASH);
    return null;
  }

  const rows = await withRole("sentinel_auth", null, async (tx) => {
    return tx.$queryRaw<CredentialRow[]>`
      SELECT c."userId", c."passwordHash", u.role::text AS role
      FROM "PersonnelCredential" c
      JOIN "User" u ON u.id = c."userId"
      WHERE c."loginId" = ${id}
    `;
  });

  const row = rows[0];
  if (!row) {
    await verifyPassword(password, DECOY_HASH);
    return null;
  }

  if (!(await verifyPassword(password, row.passwordHash))) return null;

  // The role check happens AFTER the password check, on purpose. Rejecting a
  // PERSONNEL account before verifying its password would let anyone discover
  // which accounts are staff by timing the response.
  if (!isConsoleRole(row.role)) return null;

  await withRole("sentinel_auth", null, async (tx) => {
    await tx.$executeRaw`
      UPDATE "PersonnelCredential" SET "lastLoginAt" = now()
      WHERE "userId" = ${row.userId}
    `;
  });

  return { userId: row.userId, role: row.role };
}
