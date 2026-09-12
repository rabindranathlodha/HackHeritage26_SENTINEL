import { redirect } from "next/navigation";

import { Card, Eyebrow } from "@/components/console";
import { translator } from "@/content/console";
import { consoleLocale } from "@/lib/consoleLocale";
import { readSession } from "@/lib/session";
import { cohortSummary } from "@/lib/welfare";

export const metadata = { title: "Units" };

/** bigint out of Postgres; React will not render one, and Number() is lossless here. */
function count(value: bigint | null): number {
  return value === null ? 0 : Number(value);
}

const BANDS = [
  { key: "low_count", labelKey: "bandLow", bar: "bg-band-low" },
  { key: "moderate_count", labelKey: "bandModerate", bar: "bg-band-moderate" },
  { key: "elevated_count", labelKey: "bandElevated", bar: "bg-band-elevated" },
  { key: "priority_count", labelKey: "bandPriority", bar: "bg-band-priority" },
] as const;

export default async function CohortPage() {
  const session = await readSession();
  if (!session) redirect("/welfare/login");

  // Middleware turned an officer away already; the database would refuse them
  // too, since sentinel_cohort_summary is granted to the commander role alone.
  // This is the third of three layers, and the least authoritative.
  if (session.role === "WELFARE_OFFICER") redirect("/welfare");

  const t = translator(await consoleLocale());
  const { rows, threshold } = await cohortSummary(session.userId, session.role);
  const suppressed = rows.filter((row) => row.refused);

  return (
    <main
      data-testid="cohort-root"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8"
    >
      <div className="flex flex-col gap-2">
        <Eyebrow>{t("cohortEyebrow")}</Eyebrow>
        <h1 className="text-3xl font-bold">{t("cohortTitle")}</h1>
        <p className="text-ink-2 max-w-2xl leading-relaxed">{t("cohortIntro")}</p>
      </div>

      <p className="bg-accent-soft text-accent-ink rounded-md px-4 py-3 text-sm leading-relaxed">
        {t("cohortThreshold", { k: threshold })}
      </p>

      <div className="flex flex-col gap-3">
        {rows.length === 0 && (
          <Card>
            <p className="text-ink-2">{t("cohortNone")}</p>
          </Card>
        )}

        {rows.map((row) => {
          if (row.refused) {
            // The refusal is a RESULT, rendered as one. Not an empty state, not
            // a zero, not a row quietly missing from the list — the visible
            // refusal is the privacy control doing its job where a commander
            // can see it happen.
            return (
              <Card key={row.unit_id} className="border-dashed" testId="cohort-withheld">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold">{row.unit_id}</span>
                  <span className="meta text-ink-3">{t("cohortWithheld")}</span>
                </div>
                <p className="text-ink-2 mt-2 text-sm leading-relaxed">
                  {t("cohortWithheldBody", { k: threshold })}
                </p>
              </Card>
            );
          }

          const n = count(row.n);
          const mean = row.mean_score === null ? null : Number(row.mean_score);

          return (
            <Card key={row.unit_id}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-semibold">{row.unit_id}</span>
                <span className="text-ink-2 num text-sm">
                  {t("cohortPeople", { count: n })}
                  {mean === null ? "" : ` · ${t("cohortMean", { value: mean.toFixed(1) })}`}
                </span>
              </div>

              {/* One stacked bar per unit, so units are comparable by shape at a
                  glance rather than by reading four numbers each. */}
              <div className="bg-sunk mt-4 flex h-3 w-full overflow-hidden rounded-full">
                {BANDS.map((band) => {
                  const value = count(row[band.key]);
                  if (value === 0) return null;
                  return (
                    <div
                      key={band.key}
                      className={band.bar}
                      style={{ width: `${(value / n) * 100}%` }}
                      title={`${t(band.labelKey)}: ${value}`}
                    />
                  );
                })}
              </div>

              <dl className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {BANDS.map((band) => (
                  <div key={band.key} className="flex items-center gap-2">
                    <span aria-hidden className={`${band.bar} size-2 rounded-full`} />
                    <dt className="text-ink-3">{t(band.labelKey)}</dt>
                    <dd className="font-medium">{count(row[band.key])}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          );
        })}
      </div>

      {suppressed.length > 0 && (
        <p className="text-ink-3 text-[13px] leading-relaxed">
          {t("cohortSuppressedNote", {
            suppressed: suppressed.length,
            total: rows.length,
            k: threshold,
          })}
        </p>
      )}
    </main>
  );
}
