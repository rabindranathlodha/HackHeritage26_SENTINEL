import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Role enforcement for the Welfare Console.
//
// The page components also redirect, and that is not where the rule lives. A
// redirect inside a page is a decision made AFTER the page has been matched,
// imported and begun executing — it stops the wrong person seeing the screen,
// but only because the component remembered to check. Middleware runs before
// any of that, on every request, including ones that reach a route nobody
// thought to guard.
//
// So this is the enforcement and the page redirects are defence in depth. The
// ordering matters for a specific failure: a route added later inherits the
// matcher automatically and is default-denied, whereas it would inherit nothing
// from a per-page check.
//
// Data access is still gated a third time, in the database. A commander who
// somehow reached /welfare/person/x would be refused by
// sentinel_officer_may_view(), because that role holds no grant on the audited
// accessor at all. Three layers, and only the innermost one is authoritative.

const COOKIE = "sentinel-console";
const ISSUER = "sentinel-console";

/** Routes only a commander (or admin) may reach. */
const COMMANDER_ONLY = ["/welfare/cohort"];

/** Routes only an assigned welfare officer (or admin) may reach. */
const OFFICER_ONLY = ["/welfare/person"];

type Claims = { sub: string; role: string };

async function readClaims(request: NextRequest): Promise<Claims | null> {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return null;

  const secret = process.env.NEXTAUTH_SECRET;
  // Fail closed. An unset signing key must mean "nobody is signed in", never
  // "the signature is optional".
  if (!secret || secret.length < 16) return null;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { issuer: ISSUER },
    );
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The sign-in screen is the one public page under /welfare. Everything else
  // is denied by default, which is the point of matching the whole subtree
  // rather than listing the private routes.
  if (pathname === "/welfare/login") return NextResponse.next();

  const claims = await readClaims(request);
  if (!claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/welfare/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isCommander = claims.role === "COMMANDER" || claims.role === "ADMIN";
  const isOfficer = claims.role === "WELFARE_OFFICER" || claims.role === "ADMIN";

  if (COMMANDER_ONLY.some((prefix) => pathname.startsWith(prefix)) && !isCommander) {
    // Sent to their own landing page rather than shown a 403. An officer who
    // followed a stale link has done nothing wrong and does not need a lecture.
    const url = request.nextUrl.clone();
    url.pathname = "/welfare";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (OFFICER_ONLY.some((prefix) => pathname.startsWith(prefix)) && !isOfficer) {
    const url = request.nextUrl.clone();
    url.pathname = isCommander ? "/welfare/cohort" : "/welfare";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A commander has no caseload, so the queue is not theirs either.
  if (pathname === "/welfare" && !isOfficer) {
    const url = request.nextUrl.clone();
    url.pathname = "/welfare/cohort";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // The whole console subtree, and nothing else. Route handlers under /api are
  // deliberately excluded: they authenticate with the shared internal token
  // between servers, not with a browser session, and putting them behind a
  // cookie check would break the Companion without securing anything.
  matcher: ["/welfare/:path*"],
};
