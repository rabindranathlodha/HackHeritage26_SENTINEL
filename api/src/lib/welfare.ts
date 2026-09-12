import { withRole } from "./withRole.ts";
import type { ConsoleRole } from "./session.ts";

// Data access for the Welfare Console.
//
// Every function here goes through a SECURITY DEFINER accessor in the database
// rather than reading a table directly, because that is where the rules live:
//
//   sentinel_officer_alert_queue()       -> logs VIEW_ALERT_QUEUE
//   sentinel_officer_view_scores(t)      -> checks assignment + active alert,
//                                           logs VIEW_INDIVIDUAL_SCORE
//   sentinel_officer_view_assessments(t) -> same, logs VIEW_INDIVIDUAL_ASSESSMENT
//   sentinel_cohort_summary(unit, band)  -> k-anonymity, commander only
//
// The officer role holds no direct SELECT on Score, Assessment or AuditLog. So
// an individual welfare row cannot be read without an audit row being written
// in the same transaction — not because this file remembers to log, but because
// there is no other way in. Delete every line below and the guarantee holds.

export type RiskBand = "LOW" | "MODERATE" | "ELEVATED" | "PRIORITY_REVIEW";

export type AlertRow = {
  id: string;
  userId: string;
  createdAt: Date;
  band: RiskBand;
  status: string;
  reviewedBy: string | null;
  /**
   * Whether this person has agreed to be contacted first.
   *
   * Carried on the alert because an officer needs it at the moment they are
   * deciding what to do, not one screen later. It never affects WHETHER the
   * alert appears — see outreachGuidance().
   */
  allowWelfareOutreach: boolean;
};

export type ScoreRow = {
  id: string;
  userId: string;
  computedAt: Date;
  scoreA: number;
  scoreB: number | null;
  scoreC: number | null;
  sentinelScore: number;
  band: RiskBand;
  confidenceLow: number;
  confidenceHigh: number;
  shapCategories: Record<string, number>;
  overrideFired: boolean;
};

export type AssessmentRow = {
  id: string;
  userId: string;
  submittedAt: Date;
  language: string;
};

export type CohortRow = {
  unit_id: string;
  refused: boolean;
  reason: string | null;
  n: bigint | null;
  low_count: bigint | null;
  moderate_count: bigint | null;
  elevated_count: bigint | null;
  priority_count: bigint | null;
  mean_score: unknown;
};

export type AuditRow = {
  id: string;
  action: string;
  target_user_id: string | null;
  at: Date;
};

/** The officer's own queue: assigned people with an alert that is not ACTIONED. */
export async function alertQueue(officerId: string): Promise<AlertRow[]> {
  return withRole("sentinel_welfare_officer", officerId, async (tx) => {
    // Two statements rather than one, because the queue comes from the audited
    // accessor and that function returns SETOF "Alert". Widening its signature
    // to carry a preference column would mean changing the one function whose
    // shape the audit guarantee is written against, to add something that has
    // no bearing on access control.
    const alerts = await tx.$queryRaw<Omit<AlertRow, "allowWelfareOutreach">[]>`
      SELECT * FROM sentinel_officer_alert_queue()
    `;
    if (alerts.length === 0) return [];

    const preferences = await tx.$queryRaw<
      { id: string; allowWelfareOutreach: boolean }[]
    >`
      SELECT id, "allowWelfareOutreach" FROM "User"
      WHERE id = ANY(${alerts.map((a) => a.userId)}::text[])
    `;
    const allows = new Map(preferences.map((row) => [row.id, row.allowWelfareOutreach]));

    return alerts.map((alert) => ({
      ...alert,
      // Default false: if the preference could not be read, the officer is
      // told to hold off rather than told to go ahead.
      allowWelfareOutreach: allows.get(alert.userId) ?? false,
    }));
  });
}

export type OutreachGuidance = {
  /** May the officer contact this person on their own initiative? */
  mayContact: boolean;
  /** Shown when severity overrides the preference for visibility. */
  overridden: boolean;
  tone: "clear" | "hold" | "judgement";
};

/**
 * What an officer is told to do about contact, given a band and a preference.
 *
 * The rule this encodes, written once so no screen can quietly differ:
 *
 *   - The preference NEVER suppresses an alert. Nothing here returns "hide".
 *   - Below PRIORITY_REVIEW with the preference off, the officer is told to
 *     hold off. The person can still come to them.
 *   - At PRIORITY_REVIEW the alert is shown and the decision is the officer's.
 *     Suppressing the highest-severity welfare signal on a preference toggle
 *     could cost a life, and a person who set that toggle was answering a
 *     question about ordinary contact, not waiving a serious one.
 *
 * The override is surfaced, not silent: the officer is told the person did not
 * agree to be approached, so the judgement they make is an informed one.
 */
export function outreachGuidance(
  band: RiskBand,
  allowWelfareOutreach: boolean,
): OutreachGuidance {
  if (allowWelfareOutreach) {
    return { mayContact: true, overridden: false, tone: "clear" };
  }
  if (band === "PRIORITY_REVIEW") {
    return { mayContact: true, overridden: true, tone: "judgement" };
  }
  return { mayContact: false, overridden: false, tone: "hold" };
}

/**
 * One person's score history, newest first.
 *
 * Throws if the officer is not assigned to them or no alert is active. That
 * refusal comes from the database, not from a check here — the point is that it
 * cannot be forgotten at a call site.
 */
export async function personScores(
  officerId: string,
  targetId: string,
): Promise<ScoreRow[]> {
  return withRole("sentinel_welfare_officer", officerId, async (tx) => {
    return tx.$queryRaw<ScoreRow[]>`
      SELECT * FROM sentinel_officer_view_scores(${targetId})
    `;
  });
}

export async function personAssessments(
  officerId: string,
  targetId: string,
): Promise<AssessmentRow[]> {
  return withRole("sentinel_welfare_officer", officerId, async (tx) => {
    return tx.$queryRaw<AssessmentRow[]>`
      SELECT id, "userId", "submittedAt", language
      FROM sentinel_officer_view_assessments(${targetId})
    `;
  });
}

/**
 * The audit trail the officer themselves generated.
 *
 * Shown to the officer on purpose. A surveillance tool that logs quietly and
 * never shows the log to the person doing the looking teaches its users that
 * the log is someone else's problem; showing it makes the accountability
 * mutual, and it is the same trail the person's own record notice refers to.
 */
export async function myAccessLog(
  officerId: string,
  limit = 12,
): Promise<AuditRow[]> {
  return withRole("sentinel_welfare_officer", officerId, async (tx) => {
    // Not a SELECT on "AuditLog" — the officer role holds no privilege on that
    // table, by design. The accessor filters to the caller inside the database.
    // ::int is load-bearing. Prisma binds a JS number as bigint, Postgres does
    // not implicitly cast bigint to integer when resolving a function, and the
    // failure is "function ... does not exist" rather than a type error.
    return tx.$queryRaw<AuditRow[]>`
      SELECT * FROM sentinel_officer_access_log(${limit}::int)
    `;
  });
}

/** Marks an alert reviewed or actioned. A person decides; nothing here decides. */
export async function setAlertStatus(
  officerId: string,
  alertId: string,
  status: "REVIEWED" | "ACTIONED",
): Promise<void> {
  await withRole("sentinel_welfare_officer", officerId, async (tx) => {
    await tx.$executeRaw`
      UPDATE "Alert"
      SET status = ${status}, "reviewedBy" = ${officerId}
      WHERE id = ${alertId}
    `;
  });
}

/**
 * Cohort aggregates for a commander. Runs as sentinel_commander, which is the
 * ONLY role granted this function — an officer calling it gets a permission
 * error rather than a filtered answer.
 *
 * Rows come back with `refused: true` and every figure NULL when the cohort is
 * below the k-anonymity threshold. That is a result, not an error, and the UI
 * renders it as one.
 */
export async function cohortSummary(
  actorId: string,
  role: ConsoleRole,
): Promise<{ rows: CohortRow[]; threshold: number }> {
  // Always sentinel_commander, including for an ADMIN user: that role is the
  // only one granted sentinel_cohort_summary, and running as sentinel_admin
  // would fail on the grant rather than return a different answer.
  void role;
  return withRole("sentinel_commander", actorId, async (tx) => {
    const rows = await tx.$queryRaw<CohortRow[]>`
      SELECT * FROM sentinel_cohort_summary(NULL, NULL)
    `;
    const [{ k }] = await tx.$queryRaw<{ k: number }[]>`
      SELECT sentinel_k_threshold() AS k
    `;
    return { rows, threshold: k };
  });
}
