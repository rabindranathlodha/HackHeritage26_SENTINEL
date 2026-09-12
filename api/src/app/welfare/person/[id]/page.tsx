import Link from "next/link";
import { redirect } from "next/navigation";

import { BandChip, Card, Eyebrow, Stamp } from "@/components/console";
import { translator, type Translate } from "@/content/console";
import { consoleLocale } from "@/lib/consoleLocale";
import { readSession } from "@/lib/session";
import {
  alertQueue,
  outreachGuidance,
  personAssessments,
  personScores,
  setAlertStatus,
  type ScoreRow,
} from "@/lib/welfare";

export const metadata = { title: "Record" };

/**
 * Reads a category name out of the model's vocabulary into an officer's.
 *
 * Not in the message dictionary: these are the SHAP category keys the ML
 * service emits, so they arrive as data rather than as copy. An unrecognised
 * key falls through to a de-underscored version of itself rather than a blank.
 */
const CATEGORY_LABEL: Record<string, string> = {
  deployment_load: "Deployment load",
  leave_pattern: "Leave pattern",
  duty_irregularity: "Duty irregularity",
  transfer_frequency: "Transfer frequency",
  training_load: "Training load",
  incident_proximity: "Incident proximity",
};

function label(key: string): string {
  return (
    CATEGORY_LABEL[key] ?? key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * The trend, drawn rather than tabulated.
 *
 * Deliberately unlabelled on the y-axis beyond its endpoints: the shape is the
 * information an officer needs ("this has been climbing for three weeks"), and
 * a precise gridline invites reading the number as a measurement it is not.
 */
function Trend({ scores, t }: { scores: ScoreRow[]; t: Translate }) {
  const series = [...scores].reverse();
  if (series.length < 2) {
    return <p className="text-ink-3 text-sm">{t("trendTooShort")}</p>;
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
        aria-label={t("trendAlt", {
          count: series.length,
          last: Math.round(last.sentinelScore),
        })}
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
      <p className="meta text-ink-3">{t("trendCaption", { count: series.length })}</p>
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
  const t = translator(await consoleLocale());

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
    const refused = error instanceof Error && /access denied/i.test(error.message);
    if (!refused) throw error;

    return (
      <main
        data-testid="person-refused-root"
        className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-10"
      >
        <Eyebrow>{t("refusedEyebrow")}</Eyebrow>
        <h1 className="text-2xl font-bold">{t("refusedTitle")}</h1>
        <p className="text-ink-2 leading-relaxed">{t("refusedBody")}</p>
        <p className="text-ink-3 text-sm">{t("refusedNote")}</p>
        <Link
          href="/welfare"
          className="text-accent-ink font-medium underline-offset-4 hover:underline"
        >
          {t("backToQueue")}
        </Link>
      </main>
    );
  }

  const latest = scores[0];
  const alerts = await alertQueue(session.userId);
  const alert = alerts.find((candidate) => candidate.userId === id);
  const guidance = alert ? outreachGuidance(alert.band, alert.allowWelfareOutreach) : null;

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
    <main
      data-testid="person-root"
      className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>{t("recordEyebrow")}</Eyebrow>
          <h1 className="text-3xl font-bold">{id}</h1>
        </div>
        {latest && <BandChip band={latest.band} />}
      </div>

      {/* Stated once, plainly, at the top. Not a toast that disappears. */}
      <p className="bg-accent-soft text-accent-ink rounded-md px-4 py-3 text-sm">
        {t("recordLogged")}
      </p>

      {!latest ? (
        <Card>
          <p className="text-ink-2">{t("recordNoIndicator")}</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <Eyebrow>{t("indicatorEyebrow")}</Eyebrow>
              <div className="flex items-baseline gap-2">
                <span className="num text-5xl font-bold">
                  {Math.round(latest.sentinelScore)}
                </span>
                <span className="text-ink-3 text-lg">/ 100</span>
              </div>
              <p className="text-ink-2 num text-sm">
                {t("indicatorRange", {
                  low: Math.round(latest.confidenceLow),
                  high: Math.round(latest.confidenceHigh),
                  at: `${new Date(latest.computedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`,
                })}
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
                  style={{ left: `${Math.max(0, Math.min(99.5, latest.sentinelScore))}%` }}
                />
              </div>
              <div className="text-ink-3 meta flex justify-between">
                <span>0</span>
                <span>100</span>
              </div>
            </div>

            {latest.overrideFired && (
              <p className="bg-band-priority-soft text-band-priority rounded-md px-4 py-3 text-sm">
                {t("overrideFired")}
              </p>
            )}

            <div className="border-line flex flex-col gap-2 border-t pt-4">
              <Eyebrow>{t("sourcesEyebrow")}</Eyebrow>
              <dl className="num grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-ink-3">{t("sourceQuestionnaire")}</dt>
                  <dd className="font-medium">{latest.scoreA.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("sourceWritten")}</dt>
                  <dd className="font-medium">
                    {latest.scoreB === null ? "—" : latest.scoreB.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("sourcePhysiological")}</dt>
                  <dd className="font-medium">
                    {latest.scoreC === null ? t("notShared") : latest.scoreC.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <Eyebrow>{t("movedEyebrow")}</Eyebrow>
            {contributions.length === 0 ? (
              <p className="text-ink-3 text-sm">{t("movedEmpty")}</p>
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
                        className={
                          entry.value >= 0 ? "bg-band-elevated h-full" : "bg-band-low h-full"
                        }
                        style={{ width: `${(Math.abs(entry.value) / widest) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-ink-3 border-line border-t pt-3 text-[13px] leading-relaxed">
              {t("movedNote")}
            </p>
          </Card>
        </div>
      )}

      <Card className="flex flex-col gap-3">
        <Eyebrow>{t("trendEyebrow")}</Eyebrow>
        <Trend scores={scores} t={t} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <Eyebrow>{t("checkInsEyebrow")}</Eyebrow>
          {assessments.length === 0 ? (
            <p className="text-ink-3 text-sm">{t("checkInsEmpty")}</p>
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
          <p className="text-ink-3 text-[13px] leading-relaxed">{t("checkInsNote")}</p>
        </Card>

        <Card className="flex flex-col gap-3">
          <Eyebrow>{t("decisionEyebrow")}</Eyebrow>
          {alert && guidance ? (
            <>
              {/* The contact preference, before the buttons rather than after.
                  It is the first thing that should shape what the officer does
                  next, and it changes what "I have made contact" means. */}
              {guidance.tone === "hold" && (
                <p className="bg-band-moderate-soft text-band-moderate rounded-md px-4 py-3 text-sm leading-relaxed">
                  <strong className="font-semibold">{t("outreachHoldLead")}</strong>{" "}
                  {t("outreachHoldBody")}
                </p>
              )}
              {guidance.tone === "judgement" && (
                <p className="bg-band-priority-soft text-band-priority rounded-md px-4 py-3 text-sm leading-relaxed">
                  <strong className="font-semibold">{t("outreachJudgementLead")}</strong>{" "}
                  {t("outreachJudgementBody")}
                </p>
              )}
              {guidance.tone === "clear" && (
                <p className="bg-accent-soft text-accent-ink rounded-md px-4 py-3 text-sm leading-relaxed">
                  {t("outreachAgreed")}
                </p>
              )}

              <p className="text-ink-2 text-sm leading-relaxed">{t("decisionNothingSent")}</p>

              <form action={review} className="flex flex-wrap gap-2 pt-1">
                <input type="hidden" name="alertId" value={alert.id} />
                <button
                  type="submit"
                  name="status"
                  value="REVIEWED"
                  className="border-line hover:bg-sunk min-h-11 rounded-md border px-4 text-sm font-medium"
                >
                  {t("markReviewed")}
                </button>
                <button
                  type="submit"
                  name="status"
                  value="ACTIONED"
                  className="bg-accent text-on-accent min-h-11 rounded-md px-4 text-sm font-semibold"
                >
                  {t("markActioned")}
                </button>
              </form>
              <p className="text-ink-3 text-[13px] leading-relaxed">{t("actionedNote")}</p>
            </>
          ) : (
            <p className="text-ink-3 text-sm">{t("decisionNoAlert")}</p>
          )}
        </Card>
      </div>

      <p className="text-ink-3 max-w-3xl text-[13px] leading-relaxed">
        {t("recordDisclaimer")}
      </p>
    </main>
  );
}
