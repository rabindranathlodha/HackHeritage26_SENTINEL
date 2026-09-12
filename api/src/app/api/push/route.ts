import { NextResponse } from "next/server";

import { authoriseInternal } from "@/lib/internalAuth";
import { addSubscription, removeSubscription } from "@/lib/preferences";

// POST/DELETE /api/push — register or drop one device for weekly reminders.
//
// What is stored is a delivery address and a language, nothing more. Every
// notification body is a fixed generic string, so this table can reveal which
// devices exist and never anything about the people holding them.

type Body = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  locale?: unknown;
};

export async function POST(request: Request) {
  const refused = authoriseInternal(request, "push subscription");
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

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "endpoint and keys.p256dh and keys.auth are required" },
      { status: 422 },
    );
  }

  const locale = body.locale === "hi" ? "hi" : "en";
  await addSubscription(userId, { endpoint, p256dh, auth, locale });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const refused = authoriseInternal(request, "push subscription");
  if (refused) return refused;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const endpoint = url.searchParams.get("endpoint");
  if (!userId || !endpoint) {
    return NextResponse.json(
      { error: "userId and endpoint are required" },
      { status: 422 },
    );
  }

  await removeSubscription(userId, endpoint);
  return NextResponse.json({ ok: true });
}
