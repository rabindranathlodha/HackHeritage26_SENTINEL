import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPreferences, setPreferences, type PreferencePatch } from "@/lib/api";

// The preferences proxy. Identity comes from the session, so a request cannot
// read or change anyone else's settings whatever it contains.

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  try {
    return NextResponse.json(await getPreferences(userId));
  } catch (error) {
    console.error("preferences unavailable", error);
    // Fail to the safe answer, as the consent proxy does. Both defaults here
    // are the ones that cannot mislead: outreach off means the screen never
    // claims somebody agreed to be contacted when the record could not be
    // read, and a reminder shown as off is a missing nudge rather than a
    // promise of one that will not arrive.
    return NextResponse.json({
      allowWelfareOutreach: false,
      reminder: { enabled: false, dow: null, hour: null, tz: null },
      devices: 0,
      unavailable: true,
    });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: PreferencePatch;
  try {
    body = (await request.json()) as PreferencePatch;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  try {
    return NextResponse.json(await setPreferences(userId, body));
  } catch (error) {
    console.error("could not change preferences", error);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
