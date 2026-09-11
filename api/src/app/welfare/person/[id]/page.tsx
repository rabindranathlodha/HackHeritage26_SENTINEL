import Link from "next/link";
import { redirect } from "next/navigation";

import { BandChip, Card, Eyebrow, Stamp } from "@/components/console";
import { readSession } from "@/lib/session";
import {
  alertQueue,
  personAssessments,
  personScores,
  setAlertStatus,
  type ScoreRow,
} from "@/lib/welfare";

export const metadata = { title: "Record" };

/** Reads a category name out of the model's vocabulary into an officer's. */
const CATEGORY_LABEL: Record<string, string> = {
  sleep: "Sleep",
  workload: "Workload",
  deployment: "Deployment pattern",
  leave: "Leave and rest",
  social: "Contact with home",
  mood: "Self-reported mood",
  physiological: "Physiological signal",
  grievance: "Open grievance",
  tenure: "Time in service",
  language: "Written reflection",
};

function label(key: string): string {
  return (
    CATEGORY_LABEL[key] ??
    key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * The trend, drawn rather than tabulated.
 *
 * Deliberately unlabelled on the y-axis beyond its endpoints: the shape is the
 * information an officer needs ("this has been climbing for three weeks"), and
 * a precise gridline invites reading the number as a measurement it is not.
 */
function Trend({ scores }: { scores: ScoreRow[] }) {
  const series = [...scores].reverse();
  if (series.length < 2) {
    return (
      <p className="text-ink-3 text-sm">
        One measurement so far — not enough for a trend.
      </p>
    );
  }

  const width = 520;
  const height = 96;
  const pad = 6;
  const points = series.map((score, i) => {
    const x = pad + (i / (series.length - 1)) * (width - pad * 2);
    // Fixed 0-100 domain, not min/max of the data: autoscaling a three-point
    // series turns a two-point wobble into a cliff.
    const y = height - pad - (score.sentinelScore / 100) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = series[series.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full"
        role="img"
        aria-label={`Indicator over the last ${series.length} measurements, ending at ${Math.round(last.sentinelScore)} out of 100.`}
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="var(--line)"
          strokeWidth="1"
        />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={points[points.length - 1].split(",")[0]}
          cy={points[points.length - 1].split(",")[1]}
          r="3.5"
          fill="var(--accent)"
        />
      </svg>
      <p className="meta text-ink-3">
        {series.length} measurements · oldest left
      </p>
    </div>
  );
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/welfare/login");
  const { id } = await params;

  // The database decides whether this is allowed, not this file. If the officer
  // is not assigned to this person, or no alert is active, the accessor raises
  // and we render the refusal rather than an empty page that looks like "this
  // person has no data".
  let scores: ScoreRow[];
  let assessments: Awaited<ReturnType<typeof personAssessments>>;
  try {
    [scores, assessments] = await Promise.all([
      personScores(session.userId, id),
      personAssessments(session.userId, id),
    ]);
  } catch (error) {
    // Only the accessor's own refusal renders as a refusal. A dropped
    // connection or a missing migration would otherwise be shown to an officer
    // as "you are not allowed to see this", which is a different and much more
    // damaging statement than "something is broken".
    const refused =
      error instanceof Error && /access denied/i.test(error.message);
    if (!refused) throw error;

    return (
      <main data-testid="person-refused-root" className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-10">
        <Eyebrow>Access refused</Eyebrow>
        <h1 className="text-2xl font-bold">
          You cannot open this record.
        </h1>
        <p className="text-ink-2 leading-relaxed">
          A welfare officer may open an individual record only where the person
          is assigned to them and an alert is currently active. That rule is
          enforced by the database, not by this screen, so it applies to every
          route into the data.
        </p>
        <p className="text-ink-3 text-sm">
          The attempt itself was not recorded as a view, because no view
          happened.
        </p>
        <Link href="/welfare" className="text-accent-ink font-medium underline-offset-4 hover:underline">
          Back to the queue
        </Link>
      </main>
    );
  }

  const latest = scores[0];
  const alerts = await alertQueue(session.userId);
  const alert = alerts.find((candidate) => candidate.userId === id);

  const contributions = latest
    ? Object.entries(latest.shapCategories ?? {})
        .map(([key, value]) => ({ key, value: Number(value) }))
        .filter((entry) => Number.isFinite(entry.value))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 6)
    : [];
  const widest = Math.max(1e-9, ...contributions.map((c) => Math.abs(c.value)));

  async function review(formData: FormData) {
    "use server";
    const status = String(formData.get("status"));
    const alertId = String(formData.get("alertId"));
    if (status !== "REVIEWED" && status !== "ACTIONED") return;
    const current = await readSession();
    if (!current) redirect("/welfare/login");
    await setAlertStatus(current.userId, alertId, status);
    redirect("/welfare");
  }

  return (
    <main data-testid="person-root" className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>Individual record</Eyebrow>
          <h1 className="text-3xl font-bold">{id}</h1>
        </div>
        {latest && <BandChip band={latest.band} />}
      </div>

      {/* Stated once, plainly, at the top. Not a toast that disappears. */}
      <p className="bg-accent-soft text-accent-ink rounded-md px-4 py-3 text-sm">
        Opening this record has been recorded against your ID, with the time.
        The person is told that this log exists and what it contains.
      </p>

      {!latest ? (
        <Card>
          <p className="text-ink-2">
            No indicator has been computed for this person yet.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <Eyebrow>Indicator</Eyebrow>
              <div className="flex items-baseline gap-2">
                <span className="num text-5xl font-bold">
                  {Math.round(latest.sentinelScore)}
                </span>
                <span className="text-ink-3 text-lg">/ 100</span>
              </div>
              <p className="text-ink-2 num text-sm">
                Plausible range {Math.round(latest.confidenceLow)}–
                {Math.round(latest.confidenceHigh)}. Computed{" "}
                <Stamp at={latest.computedAt} />.
              </p>
            </div>

            {/* The interval, drawn. A number with an interval printed beside it
                gets read as the number; a bar with a band across it gets read
                as a range, which is what it is. */}
            <div className="flex flex-col gap-1.5">
              <div className="bg-sunk relative h-2.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-accent-soft absolute inset-y-0"
                  style={{
                    left: `${Math.max(0, Math.min(100, latest.confidenceLow))}%`,
                    width: `${Math.max(1, Math.min(100, latest.confidenceHigh - latest.confidenceLow))}%`,
                  }}
                />
                <div
                  className="bg-accent absolute inset-y-0 w-[3px] rounded-full"
                  style={{
                    left: `${Math.max(0, Math.min(99.5, latest.sentinelScore))}%`,
                  }}
                />
              </div>
              <div className="text-ink-3 meta flex justify-between">
                <span>0</span>
                <span>100</span>
              </div>
            </div>

            {latest.overrideFired && (
              <p className="bg-band-priority-soft text-band-priority rounded-md px-4 py-3 text-sm">
                This band was raised by what the person said about themselves,
                over what the model inferred. Self-report wins here by design.
              </p>
            )}

            <div className="border-line flex flex-col gap-2 border-t pt-4">
              <Eyebrow>Where the indicator came from</Eyebrow>
              <dl className="num grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-ink-3">Questionnaire</dt>
                  <dd className="font-medium">{latest.scoreA.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Written</dt>
                  <dd className="font-medium">
                    {latest.scoreB === null ? "—" : latest.scoreB.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Physiological</dt>
                  <dd className="font-medium">
                    {latest.scoreC === null ? "not shared" : latest.scoreC.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <Eyebrow>What moved it</Eyebrow>
            {contributions.length === 0 ? (
              <p className="text-ink-3 text-sm">No breakdown recorded.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {contributions.map((entry) => (
                  <li key={entry.key} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{label(entry.key)}</span>
                      <span className="num text-ink-3">
                        {entry.value > 0 ? "+" : ""}
                        {entry.value.toFixed(2)}
                      </span>
                    </div>
                    <div className="bg-sunk h-2 w-full overflow-hidden rounded-full">
                      <div
                        className={entry.value >= 0 ? "bg-band-elevated h-full" : "bg-band-low h-full"}
                        style={{ width: `${(Math.abs(entry.value) / widest) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-ink-3 border-line border-t pt-3 text-[13px] leading-relaxed">
              Categories only — never the words someone wrote. Written
              reflections are read on the person&apos;s own phone and only a
              single number ever leaves it.
            </p>
          </Card>
        </div>
      )}

      <Card className="flex flex-col gap-3">
        <Eyebrow>Recent trend</Eyebrow>
        <Trend scores={scores} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <Eyebrow>Check-ins on file</Eyebrow>
          {assessments.length === 0 ? (
            <p className="text-ink-3 text-sm">None recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assessments.slice(0, 8).map((entry) => (
                <li
                  key={entry.id}
                  className="border-line flex items-baseline justify-between gap-3 border-b pb-2 text-sm last:border-0"
                >
                  <Stamp at={entry.submittedAt} />
                  <span className="meta text-ink-3">{entry.language}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-3 text-[13px] leading-relaxed">
            Dates and language only. The answers themselves are encrypted at
            rest and are not readable from this console.
          </p>
        </Card>

        <Card className="flex flex-col gap-3">
          <Eyebrow>Your decision</Eyebrow>
          {alert ? (
            <>
              <p className="text-ink-2 text-sm leading-relaxed">
                Nothing has been sent to this person and nothing will be. This
                console does not message anyone, and it never notifies a
                commander. What happens next is a conversation you choose to
                have.
              </p>
              <form action={review} className="flex flex-wrap gap-2 pt-1">
                <input type="hidden" name="alertId" value={alert.id} />
                <button
                  type="submit"
                  name="status"
                  value="REVIEWED"
                  className="border-line hover:bg-sunk min-h-11 rounded-md border px-4 text-sm font-medium"
                >
                  Mark reviewed
                </button>
                <button
                  type="submit"
                  name="status"
                  value="ACTIONED"
                  className="bg-accent text-on-accent min-h-11 rounded-md px-4 text-sm font-semibold"
                >
                  I have made contact
                </button>
              </form>
              <p className="text-ink-3 text-[13px] leading-relaxed">
                Marking it actioned closes the alert and removes your access to
                this record until a new one is raised.
              </p>
            </>
          ) : (
            <p className="text-ink-3 text-sm">No open alert for this person.</p>
          )}
        </Card>
      </div>

      <p className="text-ink-3 max-w-3xl text-[13px] leading-relaxed">
        This is a screening indicator for human review, not a diagnosis and not
        a measure of fitness or performance. It does not belong in an appraisal
        and it is not visible to the chain of command.
      </p>
    </main>
  );
}
