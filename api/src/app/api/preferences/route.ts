import { NextResponse } from "next/server";

import { authoriseInternal } from "@/lib/internalAuth";
import {
  getPreferences,
  isValidTimeZone,
  setOutreach,
  setReminder,
} from "@/lib/preferences";

// GET/PUT /api/preferences — the person's own settings.
//
// Two unrelated things share this route because they share a row and a policy:
// whether an officer may contact them, and when to remind them to check in.
// Neither has anything to do with whether a score is computed — see the column
// comment on User.allowWelfareOutreach.
//
// Runs as sentinel_personnel with the person's own id. The column grants added
// in 20260912120000 mean a bug here cannot change a role, a unit, or anyone
// else's settings, and cannot touch lastReminderSentAt at all.

type Body = {
  allowWelfareOutreach?: unknown;
  reminder?: {
    enabled?: unknown;
    dow?: unknown;
    hour?: unknown;
    tz?: unknown;
  };
};

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export async function GET(request: Request) {
  const refused = authoriseInternal(request, "preferences");
  if (refused) return refused;

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  return NextResponse.json(await getPreferences(userId));
}

export async function PUT(request: Request) {
  const refused = authoriseInternal(request, "preferences");
  if (refused) return refused;

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (typeof body.allowWelfareOutreach === "boolean") {
    await setOutreach(userId, body.allowWelfareOutreach);
  }

  if (body.reminder) {
    const { enabled, dow, hour, tz } = body.reminder;
    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "reminder.enabled must be a boolean" },
        { status: 422 },
      );
    }

    if (enabled) {
      // Validated here as well as by the CHECK constraint: a 422 naming the
      // field is a better answer than a constraint violation, and the zone is
      // checked against the runtime's own table because an unknown zone raises
      // inside the dispatcher rather than at write time — turning one person's
      // bad input into everybody's missed reminder.
      if (!isInt(dow, 0, 6)) {
        return NextResponse.json({ error: "reminder.dow must be 0-6" }, { status: 422 });
      }
      if (!isInt(hour, 0, 23)) {
        return NextResponse.json({ error: "reminder.hour must be 0-23" }, { status: 422 });
      }
      if (typeof tz !== "string" || !isValidTimeZone(tz)) {
        return NextResponse.json(
          { error: "reminder.tz must be an IANA time zone" },
          { status: 422 },
        );
      }
    }

    await setReminder(userId, {
      enabled,
      dow: enabled ? (dow as number) : null,
      hour: enabled ? (hour as number) : null,
      tz: enabled ? (tz as string) : null,
    });
  }

  // What the database now holds, not what was asked for. A settings screen that
  // echoes the request tells the person their preference was saved whether or
  // not it was.
  return NextResponse.json(await getPreferences(userId));
}
