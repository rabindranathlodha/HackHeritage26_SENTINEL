import { getTranslations } from "next-intl/server";

import type { AccessEvent } from "@/lib/schemas";

// Who has opened this person's record.
//
// The transparency screen says "every time someone opens your record, that is
// written down: who looked, and when". This is the trail itself, shown to the
// person it is about — so the promise is checkable rather than believable. For
// the users this product has to win over, a claim they can verify beats a
// stronger claim they cannot.
//
// The raw action is NEVER rendered. It arrives as VIEW_INDIVIDUAL_SCORE, and
// the word "score" must not reach the person under any circumstances — spec
// §0.5 and §9, and two tests. Every action is mapped to plain language, and an
// action this build has not seen before falls back to a neutral sentence rather
// than leaking an enum onto the screen.
const ACTION_KEY: Record<string, string> = {
  VIEW_INDIVIDUAL_SCORE: "accessOpenedRecord",
  VIEW_INDIVIDUAL_ASSESSMENT: "accessOpenedCheckIns",
};

export async function AccessHistory({ events }: { events: AccessEvent[] }) {
  const t = await getTranslations("transparency");

  return (
    <section
      data-testid="access-history"
      className="border-line bg-surface flex flex-col gap-3 rounded-xl border p-5"
    >
      <h2 className="meta text-ink-3">{t("accessHeading")}</h2>

      {events.length === 0 ? (
        // Not an absence to apologise for. "Nobody has opened your record" is
        // the single most reassuring sentence this screen can show, and it is
        // the common case.
        <p className="text-ink-2 text-[15px] leading-relaxed">{t("accessEmpty")}</p>
      ) : (
        <>
          <p className="text-ink-2 text-[15px] leading-relaxed">{t("accessBody")}</p>
          <ul className="flex flex-col gap-2.5">
            {events.map((event) => {
              const key = ACTION_KEY[event.action] ?? "accessOpenedGeneric";
              return (
                <li
                  key={event.id}
                  className="border-line flex flex-col gap-1 border-b pb-2.5 last:border-0 last:pb-0"
                >
                  <span className="text-[15px] font-medium">{t(key)}</span>
                  <span className="text-ink-3 text-[13px]">
                    {t("accessBy", { who: event.actorId })}
                    {" · "}
                    {/* Fixed to UTC and labelled. toLocaleString() would render
                        differently on the server and the client, which React
                        papers over by re-rendering — leaving a timestamp that
                        changes after load on the one screen that must not look
                        like it is editing itself. */}
                    <time dateTime={new Date(event.at).toISOString()} className="tabular-nums">
                      {new Date(event.at).toISOString().slice(0, 16).replace("T", " ")} UTC
                    </time>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
