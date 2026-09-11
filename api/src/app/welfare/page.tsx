import Link from "next/link";
import { redirect } from "next/navigation";

import { BandChip, Card, Eyebrow, Stamp, hoursSince } from "@/components/console";
import { readSession } from "@/lib/session";
import { alertQueue, myAccessLog, type AlertRow } from "@/lib/welfare";

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

  // A commander has no queue of their own — they are not assigned individuals,
  // and the cohort view is the only welfare surface their role can reach.
  if (session.role === "COMMANDER") redirect("/welfare/cohort");

  const [alerts, log] = await Promise.all([
    alertQueue(session.userId),
    myAccessLog(session.userId),
  ]);
  const sorted = [...alerts].sort(triageOrder);
  const pending = sorted.filter((alert) => alert.status === "PENDING_REVIEW");

  return (
    <main data-testid="queue-root" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>Assigned to you</Eyebrow>
        <h1 className="text-3xl font-bold">Review queue</h1>
        <p className="text-ink-2 max-w-2xl leading-relaxed">
          {pending.length === 0
            ? "Nothing is waiting for review."
            : `${pending.length} ${pending.length === 1 ? "person is" : "people are"} waiting for review. Opening a record is logged.`}
        </p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <p className="text-ink-2">
            No active alerts. People you are assigned to appear here only when an
            alert is raised, and disappear once you mark it actioned — this
            console cannot browse personnel who are doing fine.
          </p>
        </Card>
      ) : (
        <div className="border-line bg-surface overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-line bg-sunk border-b">
                  <th className="meta text-ink-3 px-5 py-3 font-medium">Person</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">Band</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">Raised</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">Waiting</th>
                  <th className="meta text-ink-3 px-5 py-3 font-medium">Status</th>
                  <th className="sr-only">Open</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((alert) => (
                  <tr key={alert.id} className="border-line border-b last:border-0">
                    <td className="px-5 py-4 font-medium">{alert.userId}</td>
                    <td className="px-5 py-4">
                      <BandChip band={alert.band} size="sm" />
                    </td>
                    <td className="text-ink-2 px-5 py-4 text-sm">
                      <Stamp at={alert.createdAt} />
                    </td>
                    <td className="num px-5 py-4 text-sm">
                      {hoursSince(alert.createdAt)} h
                    </td>
                    <td className="text-ink-2 px-5 py-4 text-sm">
                      {alert.status === "PENDING_REVIEW" ? "Pending review" : "Reviewed"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/welfare/person/${encodeURIComponent(alert.userId)}`}
                        className="text-accent-ink font-medium underline-offset-4 hover:underline"
                      >
                        Open record
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Card>
        <Eyebrow>Your access log</Eyebrow>
        <p className="text-ink-2 mt-2 text-sm leading-relaxed">
          What you have opened, as the people you support are told it is
          recorded. You cannot edit or delete this, and neither can anyone else.
        </p>
        {log.length === 0 ? (
          <p className="text-ink-3 mt-4 text-sm">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {log.map((entry) => (
              <li
                key={entry.id}
                className="border-line flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-0"
              >
                <span className="meta text-ink-3">
                  {entry.action.replaceAll("_", " ")}
                </span>
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
