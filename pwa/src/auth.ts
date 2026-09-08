import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Authentication for the Personnel Companion (PWA spec 3.2).
//
// This app never touches Postgres. The credential check happens in the app
// tier, which owns Prisma and the RLS roles, and runs there as sentinel_auth —
// a role that can read a password hash and cannot read a single welfare row.
// The PWA holds a shared token and asks a yes/no question.
//
// Sessions are JWTs, so there is no session table and no database round trip on
// every request. That matters here: personnel open this app on poor
// connections, and a session lookup is one more thing to fail.

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

type VerifyResponse = { ok: boolean; userId?: string; role?: string };

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        loginId: { label: "loginId", type: "text" },
        password: { label: "password", type: "password" },
      },
      async authorize(credentials) {
        const loginId = credentials?.loginId;
        const password = credentials?.password;
        if (typeof loginId !== "string" || typeof password !== "string") {
          return null;
        }

        const token = process.env.INTERNAL_API_TOKEN;
        if (!token) {
          // Fail closed. Without the token the app tier would refuse anyway;
          // saying so here makes a misconfiguration obvious in the logs rather
          // than looking like every password is wrong.
          console.error("INTERNAL_API_TOKEN is not set; cannot verify sign-in");
          return null;
        }

        let response: Response;
        try {
          response = await fetch(`${API_BASE_URL}/api/internal/verify-credentials`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-internal-token": token,
            },
            body: JSON.stringify({ loginId, password }),
            cache: "no-store",
          });
        } catch (error) {
          console.error("credential verification is unreachable", error);
          return null;
        }

        if (!response.ok) return null;

        const result = (await response.json()) as VerifyResponse;
        if (!result.ok || !result.userId) return null;

        // Only an opaque id and a role. No name, no email — the data model has
        // none, and a session is not where that would start.
        return { id: result.userId, role: result.role ?? "PERSONNEL" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = (user as { role?: string }).role ?? "PERSONNEL";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as string) ?? "PERSONNEL";
      }
      return session;
    },
    // The single gate. Every route except the public ones requires a session,
    // and this app admits exactly one role.
    authorized({ auth: session }) {
      return session?.user?.role === "PERSONNEL";
    },
  },
});
