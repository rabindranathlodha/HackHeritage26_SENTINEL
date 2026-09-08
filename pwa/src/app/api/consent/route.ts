import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getConsent, setConsent } from "@/lib/api";

// The consent proxy. Identity comes from the session, so a request cannot set
// or read anyone else's consent no matter what it contains.

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  try {
    return NextResponse.json({ biometricConsent: await getConsent(userId) });
  } catch (error) {
    console.error("consent unavailable", error);
    // Fail to the safe answer. If the current state cannot be read, showing the
    // toggle as OFF is the one that cannot mislead someone into thinking they
    // have shared less than they have.
    return NextResponse.json({ biometricConsent: false, unavailable: true });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { biometricConsent?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  if (typeof body.biometricConsent !== "boolean") {
    return NextResponse.json({ error: "biometricConsent must be a boolean" }, { status: 422 });
  }

  try {
    const value = await setConsent(userId, body.biometricConsent);
    return NextResponse.json({ biometricConsent: value });
  } catch (error) {
    console.error("could not change consent", error);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
