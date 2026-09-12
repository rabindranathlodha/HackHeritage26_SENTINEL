import Link from "next/link";
import { redirect } from "next/navigation";

import { BandChip, Card, Eyebrow, Stamp, hoursSince } from "@/components/console";
import { translator } from "@/content/console";
import { consoleLocale } from "@/lib/consoleLocale";
import { readSession } from "@/lib/session";
import { alertQueue, myAccessLog, outreachGuidance, type AlertRow } from "@/lib/welfare";

export const metadata = { title: "Queue" };

// Newest first is wrong for a triage queue. What matters is how long somebody
// has been waiting and how high the band is — so: band descending, then oldest
// first, because the person waiting longest at a given severity is the one most
// likely to have been missed.
const BAND_ORDER = { PRIORITY_REVIEW: 0, ELEVATED: 1, MODERATE: 2, LOW: 3 } as const;

function triageOrder(a: AlertRow, b: AlertRow): number {
  const byBand = BAND_ORDER[a.band] - BAND_ORDER[b.band];
  if (byBand !== 0) return byBand;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export default async function QueuePage() {
  const session = await readSession();
  if (!session) redirect("/welfare/login");

  // Middleware already turned a commander away before this component was
  // imported. This is defence in depth, not the enforcement — see
  // src/middleware.ts.
  if (session.role === "COMMANDER") redirect("/welfare/cohort");

  const t = translator(await consoleLocale());
  const [alerts, log] = await Promise.all([
    alertQueue(session.userId),
    myAccessLog(session.userId),
  ]);
  const sorted = [...alerts].sort(triageOrder);
  const pending = sorted.filter((alert) => alert.status === "PENDING_REVIEW");

  const waiting =
    pending.length === 0
      ? t("queueWaitingNone")
      : pending.length === 1
        ? t("queueWaitingOne")
        : t("queueWaitingMany", { count: pending.length });

  return (
    <main
      data-testid="queue-root"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8"
    >
      <div className="flex flex-col gap-2">
        <Eyebrow>{t("queueEyebrow")}</Eyebrow>
        <h1 className="text-3xl font-bold">{t("queueTitle")}</h1>
        <p className="text-ink-2 max-w-2xl leading-relaxed">{waiting}</p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <p className="text-ink-2">{t("queueEmpty")}</p>
        </Card>
      ) : (
        <div className="border-line bg-surface overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead>
                <tr className="border-line bg-sunk border-b">
                  <th className="meta text-ink-3 px-5 py-3 font-medium">{t("colPerson")}</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">{t("colBand")}</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">{t("colRaised")}</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">{t("colWaiting")}</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">{t("colContact")}</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">{t("colStatus")}</th>
                  <th className="sr-only">{t("colOpen")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((alert) => {
                  // Visible in the queue, not one screen later: an officer
                  // scanning for who to call needs to know who has asked not to
                  // be called before they pick up the phone.
                  const guidance = outreachGuidance(alert.band, alert.allowWelfareOutreach);
                  return (
                    <tr key={alert.id} className="border-line border-b last:border-0">
                      <td className="px-5 py-4 font-medium">{alert.userId}</td>
                      <td className="px-5 py-4">
                        <BandChip band={alert.band} size="sm" />
                      </td>
                      <td className="text-ink-2 px-5 py-4 text-sm">
                        <Stamp at={alert.createdAt} />
                      </td>
                      <td className="num px-5 py-4 text-sm">
                        {t("hours", { count: hoursSince(alert.createdAt) })}
                      </td>
                      <td className="px-5 py-4 text-sm">
                        {guidance.tone === "clear" && (
                          <span className="text-ink-3">{t("contactAgreed")}</span>
                        )}
                        {guidance.tone === "hold" && (
                          <span className="meta text-band-moderate">{t("contactHold")}</span>
                        )}
                        {guidance.tone === "judgement" && (
                          <span className="meta text-band-priority">
                            {t("contactJudgement")}
                          </span>
                        )}
                      </td>
                      <td className="text-ink-2 px-5 py-4 text-sm">
                        {alert.status === "PENDING_REVIEW"
                          ? t("statusPending")
                          : t("statusReviewed")}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/welfare/person/${encodeURIComponent(alert.userId)}`}
                          className="text-accent-ink font-medium underline-offset-4 hover:underline"
                        >
                          {t("openRecord")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Card>
        <Eyebrow>{t("accessEyebrow")}</Eyebrow>
        <p className="text-ink-2 mt-2 text-sm leading-relaxed">{t("accessBody")}</p>
        {log.length === 0 ? (
          <p className="text-ink-3 mt-4 text-sm">{t("accessEmpty")}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {log.map((entry) => (
              <li
                key={entry.id}
                className="border-line flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-0"
              >
                <span className="meta text-ink-3">{entry.action.replaceAll("_", " ")}</span>
                <span className="font-medium">{entry.target_user_id ?? "—"}</span>
                <span className="text-ink-3 ml-auto text-[13px]">
                  <Stamp at={entry.at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
