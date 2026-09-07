import { NextResponse } from "next/server";

import { encryptJson } from "@/lib/fieldCrypto";
import { withRole } from "@/lib/withRole";

// POST /api/assessments: features from HR history, score each available
// signal, fuse, persist, return. The consent read and the Assessment insert run
// as sentinel_personnel (RLS scopes both to the submitter); the Score insert
// runs as sentinel_scoring, which can write a score but cannot read one.
// Nothing here contacts a person or notifies a commander.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

type PhysiologicalSignals = {
  resting_hr: number;
  hrv_ms: number;
  sleep_hours: number;
  sleep_efficiency: number;
};

// Computed on-device from local history: summary statistics only, discarded
// with the request. Without it Model C declines to score.
type PhysiologicalBaseline = {
  resting_hr_mean: number;
  resting_hr_sd: number;
  hrv_ms_mean: number;
  hrv_ms_sd: number;
  sleep_hours_mean: number;
  sleep_hours_sd: number;
  sleep_efficiency_mean: number;
  sleep_efficiency_sd: number;
};

type AssessmentBody = {
  userId?: string;
  responses?: number[];
  text?: string;
  language?: string;
  signals?: PhysiologicalSignals;
  baseline?: PhysiologicalBaseline;
};

async function ml<T>(path: string, body: unknown): Promise<T> {
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

export async function POST(request: Request) {
  let body: AssessmentBody;
  try {
    body = (await request.json()) as AssessmentBody;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const { userId, responses, text, language = "en", signals, baseline } = body;

  if (!userId || !Array.isArray(responses) || responses.length === 0) {
    return NextResponse.json(
      { error: "userId and a non-empty responses array are required" },
      { status: 422 },
    );
  }
  if (!responses.every((r) => Number.isInteger(r) && r >= 0 && r <= 3)) {
    return NextResponse.json(
      { error: "responses must be Likert integers in 0-3" },
      { status: 422 },
    );
  }

  // --- Consent gate. Read as the submitter, so RLS scopes it to their own row.
  const person = await withRole("sentinel_personnel", userId, async (tx) => {
    const rows = await tx.$queryRaw<{ biometricConsent: boolean }[]>`
      SELECT "biometricConsent" FROM "User" WHERE id = ${userId}
    `;
    return rows[0] ?? null;
  });

  if (!person) {
    return NextResponse.json({ error: "unknown person" }, { status: 404 });
  }

  // --- Model A: engineer features from real history, then score.
  const featuresRes = await fetch(
    `${ML_SERVICE_URL}/internal/features/structured?user_id=${encodeURIComponent(userId)}`,
    { method: "POST", cache: "no-store" },
  );
  if (featuresRes.status === 404) {
    return NextResponse.json(
      { error: "no signal history for this person" },
      { status: 404 },
    );
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

  // --- Model B: optional. Raw text is sent for scoring and never persisted.
  let scoreB: number | null = null;
  if (typeof text === "string" && text.trim().length > 0) {
    const nlp = await ml<{ score_b: number }>("/predict/text", {
      user_id: userId,
      text,
      language,
    });
    scoreB = nlp.score_b;
  }

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

  // --- Fusion.
  const fusion = await ml<{
    sentinel_score: number;
    band: string;
    confidence: { low: number; high: number };
    override_fired: boolean;
    shap_categories: Record<string, number>;
    disclaimer: string;
  }>("/predict/fusion", {
    user_id: userId,
    score_a: structured.score_a,
    score_b: scoreB,
    score_c: physio.score_c,
    shap_categories: structured.shap_categories,
  });

  // --- Persist. The person files their own assessment; the pipeline writes the score.
  // The questionnaire is encrypted before it reaches the database (spec 9.3).
  // Plaintext answers never touch a column, a log, or a backup.
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

  // Escalation (spec 8). Only effect is a PENDING_REVIEW alert for the
  // assigned welfare officer. Tolerated rather than fatal, so a failure here
  // cannot lose the score the person just submitted.
  let escalation: { escalated: boolean; reasons: string[] } | null = null;
  try {
    escalation = await ml<{ escalated: boolean; reasons: string[] }>(
      "/internal/escalate",
      { user_id: userId, band: fusion.band },
    );
  } catch (error) {
    console.error("escalation failed; the score is still recorded", error);
  }

  return NextResponse.json({
    user_id: userId,
    sentinel_score: fusion.sentinel_score,
    band: fusion.band,
    confidence: fusion.confidence,
    override_fired: fusion.override_fired,
    shap_categories: fusion.shap_categories,
    signals_used: {
      structured: true,
      self_report: scoreB !== null,
      physiological: physio.used,
    },
    review: {
      // A pending alert is a queue entry an officer opens, not a notification.
      pending_review_raised: escalation?.escalated ?? false,
      reasons: escalation?.reasons ?? [],
      action_taken: "none",
    },
    disclaimer: fusion.disclaimer,
  });
}
