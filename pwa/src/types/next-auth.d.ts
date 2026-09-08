import type { DefaultSession } from "next-auth";

// The session carries an opaque user id and a role — nothing else exists to
// carry. The data model has no name and no email by design.
declare module "next-auth" {
  interface Session {
    user: { id: string; role: string } & DefaultSession["user"];
  }
  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
  }
}
