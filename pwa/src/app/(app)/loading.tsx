import { getTranslations } from "next-intl/server";

// Shown while a screen's data is on its way (spec 3.10).
//
// A skeleton rather than a spinner: it shows the shape of what is coming, so
// the screen does not jump when it arrives. On a slow connection in a remote
// posting this is the state a person sees most often, which is a reason to
// design it rather than leave it blank.
//
// The design's line for this moment is "OPENING YOUR PHONE'S COPY…", which is
// worth more than "Loading": it says the app is reaching for something local,
// not waiting on a network that may not be there.
export default async function Loading() {
  const t = await getTranslations("states");

  return (
    <main
      data-testid="loading-root"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-6 pt-10 pb-16"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("loading")}</span>

      {/* The shimmer is the only motion, and the global reduced-motion rule in
          globals.css stops it for anyone who has asked for that. Blocks match
          the real home screen's rhythm — eyebrow, anchor, card, two doors — so
          the arriving content lands where the skeleton already was. */}
      <div className="flex flex-col gap-5" aria-hidden>
        <div className="bg-sunk shimmer h-3 w-32 rounded-md" />
        <div className="flex flex-col gap-2.5">
          <div className="bg-sunk shimmer h-8 w-64 rounded-lg" />
          <div className="bg-sunk shimmer h-8 w-48 rounded-lg" />
        </div>
        <div className="bg-sunk shimmer mt-3 h-44 rounded-2xl" />
        <div className="bg-sunk shimmer h-[74px] rounded-xl" />
        <div className="bg-sunk shimmer h-[74px] rounded-xl" />
      </div>

      <p className="meta text-ink-3 text-center">{t("loadingLabel")}</p>
    </main>
  );
}
