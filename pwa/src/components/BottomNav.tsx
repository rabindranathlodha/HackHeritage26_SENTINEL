"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

// "Nav sits in the same three places on every screen" — one of the design's
// non-negotiables. Three destinations, never four: a person opening this at the
// end of a shift should not have to choose.
//
// Settings is deliberately not a fourth tab. The design reaches it through the
// transparency screen ("Your controls"), so that the place you go to change
// what is shared is the same place that told you what is shared.
const ITEMS = [
  { href: "/home", key: "home" },
  { href: "/journal", key: "journal" },
  { href: "/transparency", key: "privacy", also: ["/settings"] },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav
      aria-label={t("label")}
      className="border-line bg-paper sticky bottom-0 z-10 mt-auto flex border-t"
      // The home indicator on a modern handset overlaps the last few pixels of
      // the viewport; without this the third tab sits underneath it.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => {
        const extra: readonly string[] = "also" in item ? item.also : [];
        const active =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          extra.includes(pathname);

        return (
          <Link
            key={item.href}
            href={item.href}
            // aria-current is what tells a screen reader which tab you are on.
            // Colour alone says it to sighted users only.
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-[7px] px-2 pt-3 pb-5 text-[13px] ${
              active ? "text-ember-ink font-semibold" : "text-ink-2"
            }`}
          >
            {/* The dot, not a glyph. An icon set would be a second thing to
                translate and a third thing to keep consistent; a dot under the
                active label is unambiguous in both scripts. */}
            <span
              aria-hidden
              className={`size-[5px] rounded-full ${active ? "bg-ember" : "bg-transparent"}`}
            />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
