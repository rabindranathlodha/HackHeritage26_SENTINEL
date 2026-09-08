import { encryptJson } from "@/lib/fieldCrypto";
import { withRole } from "@/lib/withRole";

// The scoring pipeline, shared by both assessment routes.
//
// Two callers need identical behaviour and must return different things:
//
//   POST /api/assessments  — the demo/dashboard path. Sends raw journal text,
//                            gets the score back.
//   POST /api/assessment   — the Personnel Companion path. Sends a derived
//                            nlpContribution and gets NO score back, because
//                            the person must never see their own band
//                            (PWA spec principle 5).
//
// Two copies of this would drift, and the drift would be silent: the person's
// submission would be scored slightly differently from the demo path and
// nothing would fail. One module, two thin routes.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

export type PhysiologicalSignals = {
  resting_hr: number;
  hrv_ms: number;
  sleep_hours: number;
  sleep_efficiency: number;
};

export type PhysiologicalBaseline = {
  resting_hr_mean: number;
  resting_hr_sd: number;
  hrv_ms_mean: number;
  hrv_ms_sd: number;
  sleep_hours_mean: number;
  sleep_hours_sd: number;
  sleep_efficiency_mean: number;
  sleep_efficiency_sd: number;
};

export type PipelineInput = {
  userId: string;
  responses: number[];
  language: string;
  /**
   * The self-report signal, already a number.
   *
   * The companion app computes this on the phone and sends only this; the demo
   * path scores raw text through the ML service first and passes the result
   * here. Either way, raw text never reaches this module and is never persisted.
   */
  scoreB: number | null;
  signals?: PhysiologicalSignals;
  baseline?: PhysiologicalBaseline;
};

export type FusionResult = {
  sentinel_score: number;
  band: string;
  confidence: { low: number; high: number };
  override_fired: boolean;
  shap_categories: Record<string, number>;
  disclaimer: string;
};

export type PipelineResult = {
  fusion: FusionResult;
  physioUsed: boolean;
  escalation: { escalated: boolean; reasons: string[] } | null;
};

export class PipelineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function ml<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ML_SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`ML service ${path} responded ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Likert integers in 0-3 (the PHQ-9/GAD-7 range). Throws with a 422. */
export function validateResponses(responses: unknown): number[] {
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new PipelineError(422, "a non-empty responses array is required");
  }
  if (!responses.every((r) => Number.isInteger(r) && r >= 0 && r <= 3)) {
    throw new PipelineError(422, "responses must be Likert integers in 0-3");
  }
  return responses as number[];
}

export async function runAssessment(input: PipelineInput): Promise<PipelineResult> {
  const { userId, responses, language, scoreB, signals, baseline } = input;

  // --- Consent gate. Read as the submitter, so RLS scopes it to their own row.
  const person = await withRole("sentinel_personnel", userId, async (tx) => {
    const rows = await tx.$queryRaw<{ biometricConsent: boolean }[]>`
      SELECT "biometricConsent" FROM "User" WHERE id = ${userId}
    `;
    return rows[0] ?? null;
  });
  if (!person) throw new PipelineError(404, "unknown person");

  // --- Model A: engineer features from real history, then score.
  const featuresRes = await fetch(
    `${ML_SERVICE_URL}/internal/features/structured?user_id=${encodeURIComponent(userId)}`,
    { method: "POST", cache: "no-store" },
  );
  if (featuresRes.status === 404) {
    throw new PipelineError(404, "no signal history for this person");
  }
  if (!featuresRes.ok) {
    throw new Error(`feature pipeline responded ${featuresRes.status}`);
  }
  const features = await featuresRes.json();

  const structured = await ml<{
    score_a: number;
    band: string;
    shap_categories: Record<string, number>;
  }>("/predict/structured", { user_id: userId, features });

  // --- Model C: consent-gated. Absent consent this is a clean null, not an error.
  const physio = await ml<{ score_c: number | null; used: boolean }>(
    "/predict/physiological",
    {
      user_id: userId,
      // Consent comes from the stored flag, never from the request body.
      consent: person.biometricConsent && Boolean(signals),
      signals: person.biometricConsent ? (signals ?? null) : null,
      baseline: person.biometricConsent ? (baseline ?? null) : null,
    },
  );

  const fusion = await ml<FusionResult>("/predict/fusion", {
    user_id: userId,
    score_a: structured.score_a,
    score_b: scoreB,
    score_c: physio.score_c,
    shap_categories: structured.shap_categories,
  });

  // --- Persist. The person files their own assessment; the pipeline writes the
  // score. The questionnaire is encrypted before it reaches the database
  // (spec 9.3) — plaintext answers never touch a column, a log, or a backup.
  const responsesEnc = encryptJson(responses);

  await withRole("sentinel_personnel", userId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "Assessment" (id, "userId", "responsesEnc", "nlpContribution",
                                language, "physioContribution")
      VALUES (${`as-${crypto.randomUUID()}`}, ${userId}, ${responsesEnc},
              ${scoreB}, ${language}, ${physio.score_c})
    `;
  });

  await withRole("sentinel_scoring", null, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "Score" (id, "userId", "scoreA", "scoreB", "scoreC",
                           "sentinelScore", band, "confidenceLow", "confidenceHigh",
                           "shapCategories", "overrideFired")
      VALUES (${`sc-${crypto.randomUUID()}`}, ${userId}, ${structured.score_a},
              ${scoreB}, ${physio.score_c}, ${fusion.sentinel_score},
              ${fusion.band}::"RiskBand", ${fusion.confidence.low},
              ${fusion.confidence.high}, ${JSON.stringify(fusion.shap_categories)}::jsonb,
              ${fusion.override_fired})
    `;
  });

  // Escalation (spec 8). Only effect is a PENDING_REVIEW alert for the assigned
  // welfare officer. Tolerated rather than fatal, so a failure here cannot lose
  // the score the person just submitted.
  let escalation: { escalated: boolean; reasons: string[] } | null = null;
  try {
    escalation = await ml<{ escalated: boolean; reasons: string[] }>(
      "/internal/escalate",
      { user_id: userId, band: fusion.band },
    );
  } catch (error) {
    console.error("escalation failed; the score is still recorded", error);
  }

  return { fusion, physioUsed: physio.used, escalation };
}
