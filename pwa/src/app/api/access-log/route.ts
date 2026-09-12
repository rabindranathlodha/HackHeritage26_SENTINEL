import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getAccessLog } from "@/lib/api";

// The access-log proxy. Identity comes from the session, so a request cannot
// read anyone else's trail whatever it contains.

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  try {
    return NextResponse.json({ events: await getAccessLog(userId) });
  } catch (error) {
    console.error("access log unavailable", error);
    // An empty list reads as "nobody has looked at you", which is a far
    // stronger claim than "we could not check". The flag lets the screen say
    // the second thing instead of implying the first.
    return NextResponse.json({ events: [], unavailable: true });
  }
}
