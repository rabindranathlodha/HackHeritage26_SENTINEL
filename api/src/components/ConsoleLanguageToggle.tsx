import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  CONSOLE_LOCALES,
  CONSOLE_LOCALE_COOKIE,
  CONSOLE_LOCALE_LABELS,
  isConsoleLocale,
} from "@/content/console";
import { consoleLocale } from "@/lib/consoleLocale";

// Language for the console.
//
// A form and a server action rather than a client component: the console is
// server-rendered throughout, and this is the only interaction on the page that
// would otherwise require shipping JavaScript to change a cookie.
//
// Each label is written in its own script. Somebody looking for Hindi scans for
// "हिन्दी", not for the word "Hindi" spelled in Latin letters.
export async function ConsoleLanguageToggle() {
  const active = await consoleLocale();

  async function choose(formData: FormData) {
    "use server";
    const next = formData.get("locale");
    if (!isConsoleLocale(next)) return;
    (await cookies()).set(CONSOLE_LOCALE_COOKIE, next, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    // The console is server-rendered, so the new language only appears once
    // the tree is rebuilt.
    revalidatePath("/welfare", "layout");
  }

  return (
    <form action={choose} className="flex items-center gap-1">
      {CONSOLE_LOCALES.map((locale) => (
        <button
          key={locale}
          type="submit"
          name="locale"
          value={locale}
          lang={locale}
          aria-pressed={locale === active}
          className={`rounded-sm px-2.5 py-2 text-sm ${
            locale === active ? "text-ink font-semibold" : "text-ink-3 hover:bg-sunk"
          }`}
        >
          {CONSOLE_LOCALE_LABELS[locale]}
        </button>
      ))}
    </form>
  );
}
