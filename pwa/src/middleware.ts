import { auth } from "@/auth";

// Unauthenticated requests are redirected to /login by NextAuth's `authorized`
// callback. Protection is default-deny: the matcher below excludes the few
// public paths rather than listing the private ones, so a screen added later is
// protected without anyone remembering to protect it.
export default auth;

export const config = {
  matcher: [
    // Everything except: NextAuth's own routes, the login page, Next internals,
    // the service worker and its scope-critical siblings, and static assets.
    // The service worker MUST stay public — a redirect on /sw.js means no
    // offline support at all.
    "/((?!api/auth|login|_next/static|_next/image|sw\.js|manifest\.json|icons/|favicon\.ico|offline).*)",
  ],
};
