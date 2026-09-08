import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getCheckInStatus } from "@/lib/api";

// GET /api/check-in-status — proxy for the home screen. Identity from the
// session, so this can only ever report on the person asking.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getCheckInStatus(userId));
  } catch (error) {
    console.error("check-in status unavailable", error);
    // A home screen that cannot reach the app tier should still offer the
    // check-in rather than blocking it, so an unknown state means "due".
    return NextResponse.json({ due: true, last_check_in: null, week_starting: null });
  }
}
