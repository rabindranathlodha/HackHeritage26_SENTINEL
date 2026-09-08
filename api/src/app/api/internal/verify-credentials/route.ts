import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { verifyPassword } from "@/lib/password";
import { withRole } from "@/lib/withRole";

// POST /api/internal/verify-credentials
//
// Answers one question for the PWA's NextAuth callback: does this login id and
// password identify a PERSONNEL user? Server-to-server only — the browser never
// touches this, and the PWA holds the shared token.
//
// It runs as sentinel_auth, which can read PersonnelCredential and User and has
// no privilege on any welfare table. A flaw here cannot become a data leak
// because there is nothing here to leak.

type VerifyBody = { loginId?: string; password?: string };

type CredentialRow = {
  userId: string;
  passwordHash: string;
  role: string;
};

// Deliberately identical for "no such login" and "wrong password". Telling the
// two apart hands an attacker a list of valid ids.
//
// A function, not a shared constant: a NextResponse body is a stream and is
// consumed on first use, so a module-level instance returns an empty body on
// every request after the first. That made the two rejection paths tell
// themselves apart by body length — the exact leak this exists to prevent.
const rejected = () =>
  NextResponse.json({ ok: false, reason: "invalid_credentials" }, { status: 401 });

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through the error path.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (!expectedToken) {
    // Fail closed. An unset token must not mean "let everyone in".
    console.error("INTERNAL_API_TOKEN is not set; refusing to verify credentials");
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-internal-token"), expectedToken)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const loginId = typeof body.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!loginId || !password) return rejected();

  const rows = await withRole("sentinel_auth", null, async (tx) => {
    return tx.$queryRaw<CredentialRow[]>`
      SELECT c."userId", c."passwordHash", u.role::text AS role
      FROM "PersonnelCredential" c
      JOIN "User" u ON u.id = c."userId"
      WHERE c."loginId" = ${loginId}
    `;
  });

  const row = rows[0];
  if (!row) {
    // Spend the same work as a real verification would. Without this, a fast
    // 401 says "that login does not exist" as loudly as a message would.
    await verifyPassword(password, "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    return rejected();
  }

  if (!(await verifyPassword(password, row.passwordHash))) return rejected();

  // This app is the PERSONNEL companion. An officer or commander account must
  // not be able to sign into it even with a correct password.
  if (row.role !== "PERSONNEL") return rejected();

  await withRole("sentinel_auth", null, async (tx) => {
    await tx.$executeRaw`
      UPDATE "PersonnelCredential" SET "lastLoginAt" = now()
      WHERE "userId" = ${row.userId}
    `;
  });

  // Only what a session needs. No welfare content crosses this boundary.
  return NextResponse.json({ ok: true, userId: row.userId, role: row.role });
}
