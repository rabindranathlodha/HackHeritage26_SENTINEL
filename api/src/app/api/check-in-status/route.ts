import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { withRole } from "@/lib/withRole";

// GET /api/check-in-status?userId=... (PWA spec 7)
//
// Answers one question for the home screen: is a check-in due this week?
//
// It returns a boolean and a date, never a score, a band or a trend. "You have
// checked in" is supportive; "your score went up" is the thing this app exists
// not to say.
//
// Reads as sentinel_personnel, so RLS scopes it to the person's own rows — this
// route cannot report on anybody else even if the id is wrong.

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Monday 00:00 UTC of the week containing `now`. */
function startOfWeek(now: Date): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // getUTCDay() is 0 for Sunday; shift so the week starts on Monday.
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export async function GET(request: Request) {
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (!expectedToken) {
    console.error("INTERNAL_API_TOKEN is not set; refusing to report check-in status");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-internal-token"), expectedToken)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  const weekStart = startOfWeek(new Date());

  const rows = await withRole("sentinel_personnel", userId, async (tx) => {
    return tx.$queryRaw<{ submittedAt: Date }[]>`
      SELECT "submittedAt" FROM "Assessment"
      WHERE "userId" = ${userId} AND "submittedAt" >= ${weekStart}
      ORDER BY "submittedAt" DESC
      LIMIT 1
    `;
  });

  const latest = rows[0]?.submittedAt ?? null;

  return NextResponse.json({
    due: latest === null,
    last_check_in: latest ? latest.toISOString() : null,
    week_starting: weekStart.toISOString(),
  });
}
