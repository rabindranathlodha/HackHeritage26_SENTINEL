import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

// The shared-secret check every server-to-server route makes.
//
// Lifted out of the consent route because three more routes now need exactly
// the same thing, and the failure mode of copying it is that one copy quietly
// loses the constant-time compare or the fail-closed branch.
//
// Fails CLOSED. An unset token must not mean "let everyone in" — that is the
// single most common way an internal endpoint becomes a public one.

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through the error path.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns a response to send back, or null when the caller is authorised. */
export function authoriseInternal(request: Request, what: string): NextResponse | null {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    console.error(`INTERNAL_API_TOKEN is not set; refusing to serve ${what}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-internal-token"), expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
