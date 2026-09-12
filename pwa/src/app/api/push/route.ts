import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { registerPush, unregisterPush, type PushRegistration } from "@/lib/api";

// The push-subscription proxy.
//
// A subscription is a delivery address for one device. It is registered only
// when the person turns the reminder on, and dropped when they turn it off —
// there is no path here that subscribes somebody who did not ask.

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: PushRegistration;
  try {
    body = (await request.json()) as PushRegistration;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (
    typeof body?.endpoint !== "string" ||
    typeof body?.keys?.p256dh !== "string" ||
    typeof body?.keys?.auth !== "string"
  ) {
    return NextResponse.json({ error: "incomplete subscription" }, { status: 422 });
  }

  try {
    await registerPush(userId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("could not register the device for reminders", error);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 422 });
  }

  try {
    await unregisterPush(userId, endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("could not drop the device", error);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
