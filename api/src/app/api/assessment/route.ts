import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  PipelineError,
  runAssessment,
  validateResponses,
  type PhysiologicalBaseline,
  type PhysiologicalSignals,
} from "@/lib/assessmentPipeline";

// POST /api/assessment — the Personnel Companion path (PWA spec 7).
//
// Two differences from /api/assessments, and both are the point of the route:
//
//   1. It accepts `nlpContribution`, a number the phone computed on-device. It
//      has NO text field. Raw journal text cannot be sent here even by mistake,
//      because there is nowhere to put it.
//   2. It returns no score, no band, no confidence interval and no SHAP. The
//      person must never see their own band (PWA spec principle 5), and the
//      surest way to guarantee that is for the number never to cross this
//      boundary. A UI bug cannot leak what was never sent.
//
// Server-to-server: the PWA's proxy calls this with the shared token. The
// browser never reaches it, and identity comes from the PWA's session rather
// than from anything a client could set.

type CompanionBody = {
  userId?: string;
  responses?: number[];
  language?: string;
  nlpContribution?: number | null;
  signals?: PhysiologicalSignals;
  baseline?: PhysiologicalBaseline;
};

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (!expectedToken) {
    console.error("INTERNAL_API_TOKEN is not set; refusing to accept assessments");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-internal-token"), expectedToken)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: CompanionBody;
  try {
    body = (await request.json()) as CompanionBody;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const { userId, language = "en", nlpContribution, signals, baseline } = body;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 422 });
  }

  // A contribution is a probability or nothing. An out-of-range value would
  // silently distort the fusion, so reject rather than clamp.
  if (
    nlpContribution !== undefined &&
    nlpContribution !== null &&
    !(typeof nlpContribution === "number" && nlpContribution >= 0 && nlpContribution <= 1)
  ) {
    return NextResponse.json(
      { error: "nlpContribution must be a number in 0-1, or null" },
      { status: 422 },
    );
  }

  try {
    const responses = validateResponses(body.responses);

    const { escalation } = await runAssessment({
      userId,
      responses,
      language,
      scoreB: nlpContribution ?? null,
      signals,
      baseline,
    });

    // Deliberately thin. Everything the person needs to know is that it was
    // recorded; everything else is for the welfare officer's surface.
    return NextResponse.json({
      ok: true,
      recorded_at: new Date().toISOString(),
      // Whether a human will look at this. Not a score, and not phrased as one:
      // the companion app does not surface this to the person either.
      review: { pending_review_raised: escalation?.escalated ?? false },
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
