import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { withRole } from "@/lib/withRole";

// GET/PUT /api/consent — the wellness-signal opt-in (PWA spec 3.8, principle 4).
//
// Consent lives in one place, `User.biometricConsent`, and the scoring pipeline
// reads it from there rather than from any request body. That is what makes
// revoking it real: turning it off here takes effect on the next assessment
// without the client having to cooperate, and a client that lies about consent
// changes nothing.
//
// Runs as sentinel_personnel, whose UPDATE grant is scoped to that single
// column and whose row policy is scoped to their own row. A bug here cannot
// change a role, a unit, or anyone else's consent.

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorise(request: Request): NextResponse | null {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    console.error("INTERNAL_API_TOKEN is not set; refusing to serve consent");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-internal-token"), expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const refused = authorise(request);
  if (refused) return refused;

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  const rows = await withRole("sentinel_personnel", userId, async (tx) => {
    return tx.$queryRaw<{ biometricConsent: boolean }[]>`
      SELECT "biometricConsent" FROM "User" WHERE id = ${userId}
    `;
  });

  if (!rows[0]) return NextResponse.json({ error: "unknown person" }, { status: 404 });
  return NextResponse.json({ biometricConsent: rows[0].biometricConsent });
}

export async function PUT(request: Request) {
  const refused = authorise(request);
  if (refused) return refused;

  let body: { userId?: string; biometricConsent?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const { userId } = body;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }
  // Strictly boolean. Coercing "false" or 0 into a consent decision is exactly
  // the kind of helpfulness that turns an opt-in into an accident.
  if (typeof body.biometricConsent !== "boolean") {
    return NextResponse.json(
      { error: "biometricConsent must be true or false" },
      { status: 422 },
    );
  }
  const next = body.biometricConsent;

  const updated = await withRole("sentinel_personnel", userId, async (tx) => {
    return tx.$executeRaw`
      UPDATE "User" SET "biometricConsent" = ${next} WHERE id = ${userId}
    `;
  });

  if (updated === 0) {
    return NextResponse.json({ error: "unknown person" }, { status: 404 });
  }

  return NextResponse.json({ biometricConsent: next });
}
