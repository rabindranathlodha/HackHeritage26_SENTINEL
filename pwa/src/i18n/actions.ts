"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { LOCALE_COOKIE, isLocale } from "./locale";

// Setting the language is a server action so it works without client-side
// routing state, and so a person who switches before signing in keeps their
// choice through the redirect.
export async function setLocale(next: string): Promise<void> {
  if (!isLocale(next)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, next, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // Not httpOnly: this is a display preference, not a secret, and the client
    // reads it to keep <html lang> right on a client-side navigation.
    httpOnly: false,
  });
  revalidatePath("/", "layout");
}
