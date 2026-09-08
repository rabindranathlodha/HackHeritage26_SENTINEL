import { getTranslations } from "next-intl/server";

// Shown while a screen's data is on its way (spec 3.10).
//
// A skeleton rather than a spinner: it shows the shape of what is coming, so
// the screen does not jump when it arrives. On a slow connection in a remote
// posting this is the state a person sees most often, which is a reason to
// design it rather than leave it blank.
export default async function Loading() {
  const t = await getTranslations("states");

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("loading")}</span>

      {/* animate-pulse is the only motion, and the global reduced-motion rule
          in globals.css stops it for anyone who has asked for that. */}
      <div className="space-y-3" aria-hidden>
        <div className="bg-muted h-8 w-3/4 animate-pulse rounded-lg" />
        <div className="bg-muted h-5 w-full animate-pulse rounded-lg" />
        <div className="bg-muted h-5 w-2/3 animate-pulse rounded-lg" />
      </div>

      <div className="flex flex-col gap-3" aria-hidden>
        <div className="bg-muted h-14 w-full animate-pulse rounded-xl" />
        <div className="bg-muted h-14 w-full animate-pulse rounded-xl" />
      </div>
    </main>
  );
}
