import { redirect } from "next/navigation";

import { Card, Eyebrow } from "@/components/console";
import { readSession } from "@/lib/session";
import { cohortSummary } from "@/lib/welfare";

export const metadata = { title: "Units" };

/** bigint out of Postgres; React will not render one, and Number() is lossless here. */
function count(value: bigint | null): number {
  return value === null ? 0 : Number(value);
}

const BANDS = [
  { key: "low_count", label: "Low", bar: "bg-band-low" },
  { key: "moderate_count", label: "Moderate", bar: "bg-band-moderate" },
  { key: "elevated_count", label: "Elevated", bar: "bg-band-elevated" },
  { key: "priority_count", label: "Priority", bar: "bg-band-priority" },
] as const;

export default async function CohortPage() {
  const session = await readSession();
  if (!session) redirect("/welfare/login");

  // A welfare officer has no business in the aggregate view, and the database
  // would refuse them anyway — sentinel_cohort_summary is granted to the
  // commander role alone. Redirecting here turns a 500 into a sentence.
  if (session.role === "WELFARE_OFFICER") redirect("/welfare");

  const { rows, threshold } = await cohortSummary(session.userId, session.role);
  const suppressed = rows.filter((row) => row.refused);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>Aggregate view</Eyebrow>
        <h1 className="text-3xl font-bold">Units</h1>
        <p className="text-ink-2 max-w-2xl leading-relaxed">
          Group patterns only. No individual is identified here, and there is no
          control on this page that opens one — a commander cannot reach a
          person&apos;s record through this console at all.
        </p>
      </div>

      <p className="bg-accent-soft text-accent-ink rounded-md px-4 py-3 text-sm leading-relaxed">
        Any unit with fewer than {threshold} people is withheld entirely rather
        than rounded or blurred. With small numbers, a percentage is a name.
      </p>

      <div className="flex flex-col gap-3">
        {rows.length === 0 && (
          <Card>
            <p className="text-ink-2">No units have any scored members yet.</p>
          </Card>
        )}

        {rows.map((row) => {
          if (row.refused) {
            return (
              <Card key={row.unit_id} className="border-dashed">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold">{row.unit_id}</span>
                  <span className="meta text-ink-3">Withheld</span>
                </div>
                <p className="text-ink-2 mt-2 text-sm leading-relaxed">
                  This unit has fewer than {threshold} scored members, so nothing
                  about it is shown — not the size, not the spread, not an
                  average. That the unit exists is all this row reveals.
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
                  {n} people
                  {mean === null ? "" : ` · mean ${mean.toFixed(1)}`}
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
                      title={`${band.label}: ${value}`}
                    />
                  );
                })}
              </div>

              <dl className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {BANDS.map((band) => (
                  <div key={band.key} className="flex items-center gap-2">
                    <span aria-hidden className={`${band.bar} size-2 rounded-full`} />
                    <dt className="text-ink-3">{band.label}</dt>
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
          {suppressed.length} of {rows.length} units are withheld at the current
          threshold of {threshold}. Lowering it is a policy decision with a
          privacy cost, not a display setting.
        </p>
      )}
    </main>
  );
}
