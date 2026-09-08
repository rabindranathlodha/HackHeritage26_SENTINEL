import { NextResponse } from "next/server";

import {
  PipelineError,
  ml,
  runAssessment,
  validateResponses,
  type PhysiologicalBaseline,
  type PhysiologicalSignals,
} from "@/lib/assessmentPipeline";

// POST /api/assessments: the demo and dashboard path.
//
// Accepts raw journal text, scores it server-side, and returns the full result
// including the band. The Personnel Companion does NOT use this route — it
// posts to /api/assessment, which takes a pre-computed nlpContribution and
// returns no score at all. Both share lib/assessmentPipeline so the scoring
// cannot drift between them.
//
// Nothing here contacts a person or notifies a commander.

type AssessmentBody = {
  userId?: string;
  responses?: number[];
  text?: string;
  language?: string;
  signals?: PhysiologicalSignals;
  baseline?: PhysiologicalBaseline;
};

export async function POST(request: Request) {
  let body: AssessmentBody;
  try {
    body = (await request.json()) as AssessmentBody;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const { userId, text, language = "en", signals, baseline } = body;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  try {
    const responses = validateResponses(body.responses);

    // Model B: optional. Raw text is sent for scoring and never persisted.
    let scoreB: number | null = null;
    if (typeof text === "string" && text.trim().length > 0) {
      const nlp = await ml<{ score_b: number }>("/predict/text", {
        user_id: userId,
        text,
        language,
      });
      scoreB = nlp.score_b;
    }

    const { fusion, physioUsed, escalation } = await runAssessment({
      userId,
      responses,
      language,
      scoreB,
      signals,
      baseline,
    });

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
        physiological: physioUsed,
      },
      review: {
        // A pending alert is a queue entry an officer opens, not a notification.
        pending_review_raised: escalation?.escalated ?? false,
        reasons: escalation?.reasons ?? [],
        action_taken: "none",
      },
      disclaimer: fusion.disclaimer,
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
