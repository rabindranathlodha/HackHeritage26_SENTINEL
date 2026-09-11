import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// The Welfare Console's session.
//
// Deliberately separate from the PWA's NextAuth session and deliberately small:
// it carries an id and a role and nothing else. No name, no unit, no welfare
// content — a cookie is the one artefact that travels to a device we do not
// control, and every field in it is a field that can leak.
//
// It reuses NEXTAUTH_SECRET because that secret is already provisioned for this
// container. A second secret would be a second thing to forget to set, and the
// failure mode of a forgotten signing key is "everyone is authenticated".

const COOKIE = "sentinel-console";
const ISSUER = "sentinel-console";
const MAX_AGE_SECONDS = 60 * 60 * 8; // one shift

/** Roles allowed to hold a console session. PERSONNEL is never one of them. */
export const CONSOLE_ROLES = ["WELFARE_OFFICER", "COMMANDER", "ADMIN"] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];

export type ConsoleSession = { userId: string; role: ConsoleRole };

export function isConsoleRole(value: string): value is ConsoleRole {
  return (CONSOLE_ROLES as readonly string[]).includes(value);
}

/**
 * Fails closed. An unset secret must mean "nobody is signed in", never "the
 * signature is optional".
 */
function key(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "NEXTAUTH_SECRET is unset or too short; refusing to issue or accept a console session",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function startSession(session: ConsoleSession): Promise<void> {
  const token = await new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production only, so the console still works over plain http on
    // a demo machine without the cookie silently vanishing.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in officer, or null. Never throws on a bad or absent cookie. */
export async function readSession(): Promise<ConsoleSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER });
    const role = payload.role;
    if (typeof payload.sub !== "string" || typeof role !== "string") return null;
    if (!isConsoleRole(role)) return null;
    return { userId: payload.sub, role };
  } catch {
    // Expired, tampered with, or signed by a different key. All the same
    // answer: not signed in.
    return null;
  }
}
