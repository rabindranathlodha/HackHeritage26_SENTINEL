import { cookies } from "next/headers";

import {
  CONSOLE_LOCALE_COOKIE,
  DEFAULT_CONSOLE_LOCALE,
  isConsoleLocale,
  type ConsoleLocale,
} from "@/content/console";

// Reading the officer's chosen language.
//
// Split from the dictionary itself so the copy can be loaded and checked by a
// test under plain Node. `next/headers` cannot be imported outside a request,
// which would have made every string in the console unreachable from the guard
// that is supposed to police them.
export async function consoleLocale(): Promise<ConsoleLocale> {
  const value = (await cookies()).get(CONSOLE_LOCALE_COOKIE)?.value;
  return isConsoleLocale(value) ? value : DEFAULT_CONSOLE_LOCALE;
}
