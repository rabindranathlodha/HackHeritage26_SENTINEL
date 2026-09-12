import { NextResponse } from "next/server";

import { authoriseInternal } from "@/lib/internalAuth";
import { personalAccessLog } from "@/lib/personalLog";

// GET /api/access-log?userId=... — who has opened this person's record.
//
// The one welfare-adjacent thing the Companion is allowed to read back, and it
// is not welfare content: it is a list of accesses, with no score, no band and
// no reason attached. A person learning that their record was opened is not the
// same as learning what it said, and the second remains unavailable to them by
// design (PWA spec §0.5 — the person never sees their own score).

export async function GET(request: Request) {
  const refused = authoriseInternal(request, "access log");
  if (refused) return refused;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  const raw = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;

  const events = await personalAccessLog(userId, limit);
  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      actorId: event.actor_id,
      actorRole: event.actor_role,
      at: event.at,
    })),
  });
}
